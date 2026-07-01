import assert from "node:assert/strict";
import test from "node:test";
import { CREATIVE_CATEGORIES } from "../src/shared/creative-categories.ts";
import {
  addExistingBlockPlacement,
  addLinearBlankEntry,
  addLinearBlockPlacementEntry,
  addLinearSegmentEntry,
  addScriptElement,
  clearStrictTie,
  countBlockPlacements,
  countProjectThreads,
  countThreadBlocks,
  createBlock,
  createBlockFromScriptElement,
  createCrossThreadLooseTie,
  createEmptyThreadsState,
  createProject,
  createThread,
  deleteBlockEverywhere,
  deleteCrossThreadLooseTie,
  deleteProject,
  deleteThread,
  deriveLinearOutline,
  getBlockPlacementIds,
  getCategoryProjects,
  getIncomingCrossThreadLooseTies,
  getLinearOutline,
  getOutgoingCrossThreadLooseTies,
  getProjectLinearSequenceEntries,
  getProjectScriptElements,
  getProjectThreads,
  getThreadBlockOrder,
  getThreadDisplayBlockIds,
  getThreadDisplayPlacementIds,
  isLinearEntryCollapsed,
  linkScriptElementToEntry,
  migrateLegacyThreadsState,
  moveLinearEntry,
  moveBlockInThread,
  moveScriptElement,
  moveThreadInProject,
  parseThreadsState,
  removeLinearEntry,
  removeBlockPlacement,
  removeScriptElement,
  setStrictTie,
  unlinkScriptElement,
  updateLinearBlankEntryNote,
  updateLinearSegmentEntryTier,
  updateLinearSegmentEntryTitle,
  updateBlockText,
  updateProject,
  updateScriptElementText,
  updateScriptElementType,
  updateThread,
  type LinearSequenceEntry,
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

test("Linear View entries add placements and blanks without changing Thread order", () => {
  let state = createFixture();
  state = setStrictTie(state, "alpha", "after", "beta").state;
  const originalPlacementOrder = [...state.blockPlacementOrder];
  const originalStrictTie = state.blockPlacements.alpha.strictTies.after;

  let result = addLinearBlockPlacementEntry(state, "project-alpha", "beta", "linear-entry-beta");
  assert.equal(result.error, null);
  state = result.state;

  result = addLinearBlankEntry(state, "project-alpha", " Scene needed ", "linear-entry-blank");
  assert.equal(result.error, null);
  state = result.state;

  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-entry-beta", "linear-entry-blank"],
  );
  assert.equal(state.linearSequenceEntries["linear-entry-blank"].type, "blank");
  assert.deepEqual(state.blockPlacementOrder, originalPlacementOrder);
  assert.equal(state.blockPlacements.alpha.strictTies.after, originalStrictTie);

  state = updateLinearBlankEntryNote(state, "linear-entry-blank", " Party arrival gap ");
  const blank = state.linearSequenceEntries["linear-entry-blank"];
  assert.equal(blank.type, "blank");
  assert.equal(blank.type === "blank" ? blank.note : "", "Party arrival gap");
});

test("Linear View rejects duplicates and cross-project placements", () => {
  let state = createFixture();

  let result = addLinearBlockPlacementEntry(state, "project-alpha", "beta", "linear-entry-beta");
  assert.equal(result.error, null);
  state = result.state;

  result = addLinearBlockPlacementEntry(state, "project-alpha", "beta", "linear-entry-duplicate");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /already in Linear View/);

  result = addLinearBlockPlacementEntry(state, "project-alpha", "other", "linear-entry-other");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /from this Project/);
});

test("Linear View reorders and removes entries without touching placements", () => {
  let state = createFixture();
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addLinearBlankEntry(state, "project-alpha", "Gap", "linear-entry-blank").state;
  state = addLinearBlockPlacementEntry(state, "project-alpha", "beta", "linear-entry-beta").state;
  const originalPlacementOrder = [...state.blockPlacementOrder];

  let result = moveLinearEntry(state, "linear-entry-beta", "up");
  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-entry-alpha", "linear-entry-beta", "linear-entry-blank"],
  );

  state = removeLinearEntry(state, "linear-entry-alpha");
  assert.equal(state.blocks.alpha.text, "Alpha");
  assert.equal(state.blockPlacements.alpha.blockId, "alpha");
  assert.deepEqual(state.blockPlacementOrder, originalPlacementOrder);
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-entry-beta", "linear-entry-blank"],
  );
});

test("Linear View segments create optional folders in the same ordered sequence", () => {
  let state = createFixture();
  let result = addLinearSegmentEntry(state, "project-alpha", " Episode 1 ", "linear-segment-one");
  assert.equal(result.error, null);
  state = result.state;
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addLinearSegmentEntry(state, "project-alpha", "Episode 2", "linear-segment-two").state;
  state = addLinearBlankEntry(state, "project-alpha", "Cold open gap", "linear-entry-blank").state;

  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-segment-one", "linear-entry-alpha", "linear-segment-two", "linear-entry-blank"],
  );
  assert.equal(state.linearSequenceEntries["linear-segment-one"].type, "segment");
  assert.equal(
    state.linearSequenceEntries["linear-segment-one"].type === "segment"
      ? state.linearSequenceEntries["linear-segment-one"].title
      : "",
    "Episode 1",
  );

  state = updateLinearSegmentEntryTitle(state, "linear-segment-two", " Episode 02 ");
  assert.equal(
    state.linearSequenceEntries["linear-segment-two"].type === "segment"
      ? state.linearSequenceEntries["linear-segment-two"].title
      : "",
    "Episode 02",
  );

  result = moveLinearEntry(state, "linear-segment-two", "up");
  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-segment-one", "linear-segment-two", "linear-entry-alpha", "linear-entry-blank"],
  );

  state = removeLinearEntry(state, "linear-segment-one");
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-segment-two", "linear-entry-alpha", "linear-entry-blank"],
  );

  result = addLinearSegmentEntry(state, "project-alpha", "   ", "linear-segment-empty");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /cannot be empty/);
});

test("Linear View segments default to no tier and can be promoted to Season or Episode markers", () => {
  let state = createFixture();

  let result = addLinearSegmentEntry(state, "project-alpha", "Cold Open", "linear-segment-plain");
  assert.equal(result.error, null);
  state = result.state;
  const plainEntry = state.linearSequenceEntries["linear-segment-plain"];
  assert.equal(plainEntry.type, "segment");
  assert.equal(plainEntry.type === "segment" ? plainEntry.tier : undefined, undefined);

  result = addLinearSegmentEntry(state, "project-alpha", "Season 1", "linear-segment-season", "season");
  assert.equal(result.error, null);
  state = result.state;
  const seasonEntry = state.linearSequenceEntries["linear-segment-season"];
  assert.equal(seasonEntry.type === "segment" ? seasonEntry.tier : undefined, "season");

  result = addLinearSegmentEntry(state, "project-alpha", "Episode 1", "linear-segment-episode", "episode");
  state = result.state;
  const episodeEntry = state.linearSequenceEntries["linear-segment-episode"];
  assert.equal(episodeEntry.type === "segment" ? episodeEntry.tier : undefined, "episode");

  state = updateLinearSegmentEntryTier(state, "linear-segment-plain", "season");
  assert.equal(
    state.linearSequenceEntries["linear-segment-plain"].type === "segment"
      ? state.linearSequenceEntries["linear-segment-plain"].tier
      : undefined,
    "season",
  );

  state = updateLinearSegmentEntryTier(state, "linear-segment-plain", null);
  assert.equal(
    state.linearSequenceEntries["linear-segment-plain"].type === "segment"
      ? state.linearSequenceEntries["linear-segment-plain"].tier
      : undefined,
    undefined,
  );

  const unchanged = updateLinearSegmentEntryTier(state, "linear-segment-plain", null);
  assert.equal(unchanged, state);

  const noop = updateLinearSegmentEntryTier(state, "does-not-exist", "season");
  assert.equal(noop, state);

  const withBlank = addLinearBlankEntry(state, "project-alpha", "Gap", "linear-blank-noop").state;
  const blankNoop = updateLinearSegmentEntryTier(withBlank, "linear-blank-noop", "season");
  assert.equal(blankNoop, withBlank);
});

test("deriveLinearOutline groups Season and Episode markers from one flat sequence without storing a tree", () => {
  const entry = (partial: LinearSequenceEntry): LinearSequenceEntry => partial;

  assert.deepEqual(deriveLinearOutline([]), { nodes: [], entryInfo: [] });

  const noTiers: LinearSequenceEntry[] = [
    entry({ id: "b1", sequenceId: "s", type: "blank", note: "" }),
    entry({ id: "seg1", sequenceId: "s", type: "segment", title: "Act 2" }),
    entry({ id: "b2", sequenceId: "s", type: "blank", note: "" }),
  ];
  const noTierOutline = deriveLinearOutline(noTiers);
  assert.deepEqual(noTierOutline.nodes, []);
  assert.deepEqual(noTierOutline.entryInfo, [
    { depth: 0, seasonEntryId: null, episodeEntryId: null },
    { depth: 0, seasonEntryId: null, episodeEntryId: null },
    { depth: 0, seasonEntryId: null, episodeEntryId: null },
  ]);

  const leading: LinearSequenceEntry[] = [
    entry({ id: "lead", sequenceId: "s", type: "blank", note: "" }),
    entry({ id: "season1", sequenceId: "s", type: "segment", title: "Season 1", tier: "season" }),
  ];
  const leadingOutline = deriveLinearOutline(leading);
  assert.equal(leadingOutline.entryInfo[0].seasonEntryId, null);
  assert.equal(leadingOutline.nodes.length, 1);
  assert.equal(leadingOutline.nodes[0].startIndex, 1);
  assert.equal(leadingOutline.nodes[0].endIndex, 1);

  const full: LinearSequenceEntry[] = [
    entry({ id: "season1", sequenceId: "s", type: "segment", title: "Season 1", tier: "season" }),
    entry({ id: "ep1", sequenceId: "s", type: "segment", title: "Episode 1", tier: "episode" }),
    entry({ id: "p1", sequenceId: "s", type: "placement", placementId: "alpha" }),
    entry({ id: "plain", sequenceId: "s", type: "segment", title: "Act 2" }),
    entry({ id: "p2", sequenceId: "s", type: "placement", placementId: "beta" }),
    entry({ id: "ep2", sequenceId: "s", type: "segment", title: "Episode 2", tier: "episode" }),
    entry({ id: "p3", sequenceId: "s", type: "placement", placementId: "gamma" }),
    entry({ id: "season2", sequenceId: "s", type: "segment", title: "Season 2", tier: "season" }),
  ];
  const fullOutline = deriveLinearOutline(full);
  assert.equal(fullOutline.nodes.length, 2);
  const [season1Node, season2Node] = fullOutline.nodes;
  assert.equal(season1Node.kind, "season");
  assert.equal(season1Node.startIndex, 0);
  assert.equal(season1Node.endIndex, 6);
  assert.equal(season1Node.episodes.length, 2);
  assert.equal(season1Node.episodes[0].entryId, "ep1");
  assert.equal(season1Node.episodes[0].startIndex, 1);
  assert.equal(season1Node.episodes[0].endIndex, 4);
  assert.equal(season1Node.episodes[0].parentEntryId, "season1");
  assert.equal(season1Node.episodes[1].entryId, "ep2");
  assert.equal(season1Node.episodes[1].startIndex, 5);
  assert.equal(season1Node.episodes[1].endIndex, 6);
  assert.equal(season2Node.kind, "season");
  assert.equal(season2Node.startIndex, 7);
  assert.equal(season2Node.endIndex, 7);
  assert.equal(season2Node.episodes.length, 0);

  assert.deepEqual(fullOutline.entryInfo[0], { depth: 0, seasonEntryId: null, episodeEntryId: null });
  assert.deepEqual(fullOutline.entryInfo[1], { depth: 1, seasonEntryId: "season1", episodeEntryId: null });
  assert.deepEqual(fullOutline.entryInfo[2], { depth: 2, seasonEntryId: "season1", episodeEntryId: "ep1" });
  assert.deepEqual(fullOutline.entryInfo[3], { depth: 2, seasonEntryId: "season1", episodeEntryId: "ep1" });
  assert.deepEqual(fullOutline.entryInfo[4], { depth: 2, seasonEntryId: "season1", episodeEntryId: "ep1" });
  assert.deepEqual(fullOutline.entryInfo[5], { depth: 1, seasonEntryId: "season1", episodeEntryId: null });
  assert.deepEqual(fullOutline.entryInfo[6], { depth: 2, seasonEntryId: "season1", episodeEntryId: "ep2" });
  assert.deepEqual(fullOutline.entryInfo[7], { depth: 0, seasonEntryId: null, episodeEntryId: null });

  const orphanFirst: LinearSequenceEntry[] = [
    entry({ id: "orphanEp", sequenceId: "s", type: "segment", title: "Special", tier: "episode" }),
    entry({ id: "p1", sequenceId: "s", type: "placement", placementId: "alpha" }),
    entry({ id: "season1", sequenceId: "s", type: "segment", title: "Season 1", tier: "season" }),
    entry({ id: "nestedEp", sequenceId: "s", type: "segment", title: "Episode 1", tier: "episode" }),
  ];
  const orphanOutline = deriveLinearOutline(orphanFirst);
  assert.equal(orphanOutline.nodes.length, 2);
  assert.equal(orphanOutline.nodes[0].kind, "episode");
  assert.equal(orphanOutline.nodes[0].parentEntryId, null);
  assert.equal(orphanOutline.nodes[1].kind, "season");
  assert.equal(orphanOutline.nodes[1].episodes[0].parentEntryId, "season1");
});

test("isLinearEntryCollapsed hides nested Season and Episode content but never their own header", () => {
  const entries: LinearSequenceEntry[] = [
    { id: "season1", sequenceId: "s", type: "segment", title: "Season 1", tier: "season" },
    { id: "ep1", sequenceId: "s", type: "segment", title: "Episode 1", tier: "episode" },
    { id: "p1", sequenceId: "s", type: "placement", placementId: "alpha" },
    { id: "ep2", sequenceId: "s", type: "segment", title: "Episode 2", tier: "episode" },
    { id: "p2", sequenceId: "s", type: "placement", placementId: "beta" },
  ];
  const outline = deriveLinearOutline(entries);

  const noneCollapsed = new Set<string>();
  entries.forEach((_, index) => assert.equal(isLinearEntryCollapsed(outline, index, noneCollapsed), false));

  const seasonCollapsed = new Set(["season1"]);
  assert.equal(isLinearEntryCollapsed(outline, 0, seasonCollapsed), false);
  assert.equal(isLinearEntryCollapsed(outline, 1, seasonCollapsed), true);
  assert.equal(isLinearEntryCollapsed(outline, 2, seasonCollapsed), true);
  assert.equal(isLinearEntryCollapsed(outline, 3, seasonCollapsed), true);
  assert.equal(isLinearEntryCollapsed(outline, 4, seasonCollapsed), true);

  const episode2Collapsed = new Set(["ep2"]);
  assert.equal(isLinearEntryCollapsed(outline, 1, episode2Collapsed), false);
  assert.equal(isLinearEntryCollapsed(outline, 2, episode2Collapsed), false);
  assert.equal(isLinearEntryCollapsed(outline, 3, episode2Collapsed), false);
  assert.equal(isLinearEntryCollapsed(outline, 4, episode2Collapsed), true);

  const both = new Set(["season1", "ep2"]);
  assert.equal(isLinearEntryCollapsed(outline, 3, both), true);
  assert.equal(isLinearEntryCollapsed(outline, 4, both), true);

  const seasonOnlyRemoved = new Set(["ep2"]);
  assert.equal(isLinearEntryCollapsed(outline, 3, seasonOnlyRemoved), false);
  assert.equal(isLinearEntryCollapsed(outline, 4, seasonOnlyRemoved), true);
});

test("getLinearOutline reads a Project's Season and Episode markers through the store", () => {
  let state = createFixture();
  state = addLinearSegmentEntry(state, "project-alpha", "Season 1", "linear-season-1", "season").state;
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  const outline = getLinearOutline(state, "project-alpha");
  assert.equal(outline.nodes.length, 1);
  assert.equal(outline.nodes[0].entryId, "linear-season-1");
  assert.equal(outline.nodes[0].endIndex, 1);
});

test("Script elements are created per Project, ordered independently of Threads and Linear View", () => {
  let state = createFixture();

  let result = addScriptElement(state, "project-alpha", "scene_heading", "INT. SHIP - DAY", "script-1");
  assert.equal(result.error, null);
  state = result.state;

  result = addScriptElement(state, "project-alpha", "action", "Our hero enters.", "script-2");
  state = result.state;

  result = addScriptElement(state, "project-beta", "action", "A different Project's line.", "script-beta-1");
  state = result.state;

  assert.deepEqual(
    getProjectScriptElements(state, "project-alpha").map((element) => element.id),
    ["script-1", "script-2"],
  );
  assert.deepEqual(
    getProjectScriptElements(state, "project-beta").map((element) => element.id),
    ["script-beta-1"],
  );

  result = addScriptElement(state, "project-alpha", "dialogue", "Inserted line.", "script-inserted", "script-1");
  state = result.state;
  assert.deepEqual(
    getProjectScriptElements(state, "project-alpha").map((element) => element.id),
    ["script-1", "script-inserted", "script-2"],
  );

  result = addScriptElement(state, "missing-project", "action", "Nope.", "script-missing");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /Project not found/);

  result = addScriptElement(state, "project-alpha", "action", "Bad anchor.", "script-bad-anchor", "does-not-exist");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /not found/);
});

test("Script element text, type, and order can be edited without touching Threads or Linear View", () => {
  let state = createFixture();
  state = addScriptElement(state, "project-alpha", "scene_heading", "INT. SHIP - DAY", "script-1").state;
  state = addScriptElement(state, "project-alpha", "action", "Our hero enters.", "script-2").state;
  state = addScriptElement(state, "project-alpha", "action", "Third line.", "script-3").state;
  const originalBlockOrder = [...state.blockOrder];

  state = updateScriptElementText(state, "script-2", "Our hero enters, cautiously.");
  assert.equal(state.scriptElements["script-2"].text, "Our hero enters, cautiously.");

  state = updateScriptElementType(state, "script-2", "character");
  assert.equal(state.scriptElements["script-2"].type, "character");

  let result = moveScriptElement(state, "script-3", "up");
  assert.equal(result.error, null);
  state = result.state;
  assert.deepEqual(
    getProjectScriptElements(state, "project-alpha").map((element) => element.id),
    ["script-1", "script-3", "script-2"],
  );

  result = moveScriptElement(state, "script-1", "up");
  assert.match(result.error ?? "", /Already at the top/);

  state = removeScriptElement(state, "script-3");
  assert.deepEqual(
    getProjectScriptElements(state, "project-alpha").map((element) => element.id),
    ["script-1", "script-2"],
  );

  assert.deepEqual(state.blockOrder, originalBlockOrder);
  assert.equal(countThreadBlocks(state, "thread-alpha"), 3);
});

test("Script elements can be tagged to Linear View entries from the same Project only, and untagged", () => {
  let state = createFixture();
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addLinearBlockPlacementEntry(state, "project-beta", "other", "linear-entry-other").state;
  state = addScriptElement(state, "project-alpha", "action", "Alpha appears.", "script-1").state;

  let result = linkScriptElementToEntry(state, "script-1", "linear-entry-other");
  assert.equal(result.state, state);
  assert.match(result.error ?? "", /from this Project/);

  result = linkScriptElementToEntry(state, "script-1", "does-not-exist");
  assert.match(result.error ?? "", /Linear View entry/);

  result = linkScriptElementToEntry(state, "script-1", "linear-entry-alpha");
  assert.equal(result.error, null);
  state = result.state;
  assert.equal(state.scriptElements["script-1"].linkedEntryId, "linear-entry-alpha");

  state = unlinkScriptElement(state, "script-1");
  assert.equal(state.scriptElements["script-1"].linkedEntryId, undefined);
});

test("createBlockFromScriptElement creates a Block, Placement, and Linear entry, and tags the Script element", () => {
  let state = createFixture();
  state = addScriptElement(state, "project-alpha", "action", "  A brand new beat.  ", "script-1").state;
  const originalBlockOrder = [...state.blockOrder];

  const result = createBlockFromScriptElement(
    state,
    "script-1",
    "thread-alpha",
    "new-block",
    "new-placement",
    "new-linear-entry",
  );
  assert.equal(result.error, null);
  state = result.state;

  assert.equal(state.blocks["new-block"].text, "A brand new beat.");
  assert.equal(state.blockPlacements["new-placement"].threadId, "thread-alpha");
  assert.deepEqual(state.blockOrder, [...originalBlockOrder, "new-block"]);
  assert.equal(state.scriptElements["script-1"].linkedEntryId, "new-linear-entry");
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["new-linear-entry"],
  );

  const emptyElement = addScriptElement(state, "project-alpha", "action", "   ", "script-empty").state;
  const emptyResult = createBlockFromScriptElement(
    emptyElement,
    "script-empty",
    "thread-alpha",
    "empty-block",
    "empty-placement",
    "empty-linear-entry",
  );
  assert.equal(emptyResult.state, emptyElement);
  assert.match(emptyResult.error ?? "", /empty/);

  const wrongThreadResult = createBlockFromScriptElement(
    state,
    "script-1",
    "thread-beta",
    "wrong-block",
    "wrong-placement",
    "wrong-linear-entry",
  );
  assert.match(wrongThreadResult.error ?? "", /Thread from this Project/);
});

test("Removing a Linear View entry clears any Script tag pointing to it, without deleting the Script line", () => {
  let state = createFixture();
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addScriptElement(state, "project-alpha", "action", "Alpha appears.", "script-1").state;
  state = linkScriptElementToEntry(state, "script-1", "linear-entry-alpha").state;

  state = removeLinearEntry(state, "linear-entry-alpha");
  assert.equal(state.scriptElements["script-1"].text, "Alpha appears.");
  assert.equal(state.scriptElements["script-1"].linkedEntryId, undefined);
});

test("Deleting Threads, Placements, and Projects prunes Script tags but preserves Script text", () => {
  let state = createFixture();
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addScriptElement(state, "project-alpha", "action", "Alpha appears.", "script-1").state;
  state = linkScriptElementToEntry(state, "script-1", "linear-entry-alpha").state;

  state = removeBlockPlacement(state, "alpha");
  assert.equal(state.scriptElements["script-1"].text, "Alpha appears.");
  assert.equal(state.scriptElements["script-1"].linkedEntryId, undefined);

  state = addLinearBlockPlacementEntry(state, "project-alpha", "beta", "linear-entry-beta").state;
  state = linkScriptElementToEntry(state, "script-1", "linear-entry-beta").state;
  state = deleteThread(state, "thread-alpha");
  assert.equal(state.scriptElements["script-1"].text, "Alpha appears.");
  assert.equal(state.scriptElements["script-1"].linkedEntryId, undefined);

  state = deleteProject(state, "project-alpha");
  assert.equal(state.scriptElements["script-1"], undefined);
  assert.equal(getProjectScriptElements(state, "project-alpha").length, 0);
});

test("Deleting placements, Threads, Blocks, and Projects prunes Linear View references", () => {
  let state = createFixture();
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addLinearBlockPlacementEntry(state, "project-alpha", "beta", "linear-entry-beta").state;
  state = addLinearBlankEntry(state, "project-alpha", "Gap", "linear-entry-blank").state;
  state = addLinearSegmentEntry(state, "project-alpha", "Season 1", "linear-season-1", "season").state;

  state = removeBlockPlacement(state, "beta");
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-entry-alpha", "linear-entry-blank", "linear-season-1"],
  );
  assert.equal(state.linearSequenceEntries["linear-entry-beta"], undefined);
  assert.equal(state.linearSequenceEntries["linear-season-1"].type, "segment");

  state = deleteThread(state, "thread-alpha");
  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-entry-blank", "linear-season-1"],
  );
  assert.equal(state.linearSequenceEntries["linear-season-1"].type, "segment");

  state = addLinearBlockPlacementEntry(state, "project-beta", "other", "linear-entry-other").state;
  state = deleteBlockEverywhere(state, "other");
  assert.deepEqual(getProjectLinearSequenceEntries(state, "project-beta"), []);

  state = deleteProject(state, "project-alpha");
  assert.deepEqual(state.linearSequenceOrder, ["linear-project-beta"]);
  assert.equal(state.linearSequenceEntries["linear-entry-blank"], undefined);
  assert.equal(state.linearSequenceEntries["linear-season-1"], undefined);
});

test("Moving a Thread between Projects prunes stale Linear View placement entries", () => {
  let state = createFixture();
  state = addLinearBlockPlacementEntry(state, "project-alpha", "alpha", "linear-entry-alpha").state;
  state = addLinearBlankEntry(state, "project-alpha", "Gap", "linear-entry-blank").state;

  state = updateThread(state, "thread-alpha", { projectId: "project-beta" });

  assert.deepEqual(
    getProjectLinearSequenceEntries(state, "project-alpha").map((entry) => entry.id),
    ["linear-entry-blank"],
  );
  assert.equal(state.linearSequenceEntries["linear-entry-alpha"], undefined);
});

test("Threads parser normalizes malformed v5 state, strict ties, callback links, and Linear View", () => {
  const parsed = parseThreadsState(JSON.stringify({
    version: 5,
    projectOrder: ["alpha-project", "missing", "alpha-project"],
    threadOrder: ["alpha-thread", "missing", "alpha-thread"],
    blockOrder: ["alpha", "bravo", "cross-thread", "unused", "missing", "alpha"],
    blockPlacementOrder: ["alpha-place", "bravo-place", "cross-place", "duplicate-place", "missing", "alpha-place"],
    crossThreadLooseTieOrder: ["valid-link", "self-link", "valid-link"],
    linearSequenceOrder: ["linear-alpha", "linear-beta", "linear-duplicate", "linear-alpha"],
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
    linearSequences: {
      "linear-alpha": {
        id: "linear-alpha",
        projectId: "alpha-project",
        entryOrder: [
          "linear-place-alpha",
          "linear-place-duplicate",
          "linear-segment",
          "linear-empty-segment",
          "linear-season-segment",
          "linear-garbage-tier-segment",
          "linear-blank",
          "linear-place-cross-project",
          "linear-missing",
        ],
      },
      "linear-beta": {
        id: "linear-beta",
        projectId: "beta-project",
        entryOrder: ["linear-place-cross"],
      },
      "linear-duplicate": {
        id: "linear-duplicate",
        projectId: "alpha-project",
        entryOrder: ["linear-duplicate-sequence-entry"],
      },
      "linear-orphan": {
        id: "linear-orphan",
        projectId: "missing",
        entryOrder: ["linear-orphan-entry"],
      },
    },
    linearSequenceEntries: {
      "linear-place-alpha": {
        id: "linear-place-alpha",
        sequenceId: "linear-alpha",
        type: "placement",
        placementId: "alpha-place",
      },
      "linear-place-duplicate": {
        id: "linear-place-duplicate",
        sequenceId: "linear-alpha",
        type: "placement",
        placementId: "alpha-place",
      },
      "linear-blank": {
        id: "linear-blank",
        sequenceId: "linear-alpha",
        type: "blank",
        note: " Gap ",
      },
      "linear-segment": {
        id: "linear-segment",
        sequenceId: "linear-alpha",
        type: "segment",
        title: " Episode 1 ",
      },
      "linear-empty-segment": {
        id: "linear-empty-segment",
        sequenceId: "linear-alpha",
        type: "segment",
        title: "   ",
      },
      "linear-season-segment": {
        id: "linear-season-segment",
        sequenceId: "linear-alpha",
        type: "segment",
        title: "Season 1",
        tier: "season",
      },
      "linear-garbage-tier-segment": {
        id: "linear-garbage-tier-segment",
        sequenceId: "linear-alpha",
        type: "segment",
        title: "Act 3",
        tier: "act3",
      },
      "linear-place-cross-project": {
        id: "linear-place-cross-project",
        sequenceId: "linear-alpha",
        type: "placement",
        placementId: "cross-place",
      },
      "linear-place-cross": {
        id: "linear-place-cross",
        sequenceId: "linear-beta",
        type: "placement",
        placementId: "cross-place",
      },
      "linear-duplicate-sequence-entry": {
        id: "linear-duplicate-sequence-entry",
        sequenceId: "linear-duplicate",
        type: "blank",
        note: "Drop me",
      },
      "linear-orphan-entry": {
        id: "linear-orphan-entry",
        sequenceId: "linear-orphan",
        type: "blank",
        note: "Drop me",
      },
    },
    scriptDocumentOrder: ["script-doc-alpha", "script-doc-duplicate", "script-doc-orphan"],
    scriptDocuments: {
      "script-doc-alpha": {
        id: "script-doc-alpha",
        projectId: "alpha-project",
        elementOrder: [
          "script-el-linked",
          "script-el-stale-link",
          "script-el-garbage-type",
          "script-el-missing",
        ],
      },
      "script-doc-duplicate": {
        id: "script-doc-duplicate",
        projectId: "alpha-project",
        elementOrder: ["script-el-duplicate-doc"],
      },
      "script-doc-orphan": {
        id: "script-doc-orphan",
        projectId: "missing",
        elementOrder: ["script-el-orphan-doc"],
      },
    },
    scriptElements: {
      "script-el-linked": {
        id: "script-el-linked",
        documentId: "script-doc-alpha",
        type: "action",
        text: "Alpha appears.",
        linkedEntryId: "linear-place-alpha",
      },
      "script-el-stale-link": {
        id: "script-el-stale-link",
        documentId: "script-doc-alpha",
        type: "character",
        text: "ALPHA",
        linkedEntryId: "linear-place-duplicate",
      },
      "script-el-garbage-type": {
        id: "script-el-garbage-type",
        documentId: "script-doc-alpha",
        type: "montage",
        text: "Not a real type.",
      },
      "script-el-duplicate-doc": {
        id: "script-el-duplicate-doc",
        documentId: "script-doc-duplicate",
        type: "action",
        text: "Drop me, duplicate document.",
      },
      "script-el-orphan-doc": {
        id: "script-el-orphan-doc",
        documentId: "script-doc-orphan",
        type: "action",
        text: "Drop me, orphan project.",
      },
    },
  }));

  assert.equal(parsed.version, 5);
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
  assert.deepEqual(parsed.linearSequenceOrder, ["linear-alpha", "linear-beta"]);
  assert.deepEqual(
    parsed.linearSequences["linear-alpha"].entryOrder,
    ["linear-place-alpha", "linear-segment", "linear-season-segment", "linear-garbage-tier-segment", "linear-blank"],
  );
  assert.deepEqual(parsed.linearSequences["linear-beta"].entryOrder, ["linear-place-cross"]);
  const segment = parsed.linearSequenceEntries["linear-segment"];
  assert.equal(segment.type, "segment");
  assert.equal(segment.type === "segment" ? segment.title : "", "Episode 1");
  assert.equal(segment.type === "segment" ? segment.tier : "unset", undefined);
  const seasonSegment = parsed.linearSequenceEntries["linear-season-segment"];
  assert.equal(seasonSegment.type === "segment" ? seasonSegment.tier : "unset", "season");
  const garbageTierSegment = parsed.linearSequenceEntries["linear-garbage-tier-segment"];
  assert.equal(garbageTierSegment.type, "segment");
  assert.equal(garbageTierSegment.type === "segment" ? garbageTierSegment.tier : "unset", undefined);
  const blank = parsed.linearSequenceEntries["linear-blank"];
  assert.equal(blank.type, "blank");
  assert.equal(blank.type === "blank" ? blank.note : "", "Gap");
  assert.equal(parsed.linearSequenceEntries["linear-place-duplicate"], undefined);
  assert.equal(parsed.linearSequenceEntries["linear-empty-segment"], undefined);
  assert.equal(parsed.linearSequenceEntries["linear-place-cross-project"], undefined);
  assert.equal(parsed.linearSequences["linear-duplicate"], undefined);

  assert.deepEqual(
    Object.keys(parsed.scriptDocuments).filter((id) => parsed.scriptDocuments[id].projectId === "alpha-project"),
    ["script-doc-alpha"],
  );
  assert.equal(parsed.scriptDocuments["script-doc-duplicate"], undefined);
  assert.equal(parsed.scriptDocuments["script-doc-orphan"], undefined);
  assert.deepEqual(
    parsed.scriptDocuments["script-doc-alpha"].elementOrder,
    ["script-el-linked", "script-el-stale-link"],
  );
  assert.equal(parsed.scriptElements["script-el-linked"].linkedEntryId, "linear-place-alpha");
  assert.equal(parsed.scriptElements["script-el-stale-link"].linkedEntryId, undefined);
  assert.equal(parsed.scriptElements["script-el-garbage-type"], undefined);
  assert.equal(parsed.scriptElements["script-el-duplicate-doc"], undefined);
  assert.equal(parsed.scriptElements["script-el-orphan-doc"], undefined);
});

test("Threads migration imports v4 state with empty Linear Sequences", () => {
  const migrated = parseThreadsState(JSON.stringify({
    version: 4,
    projectOrder: ["alpha-project", "beta-project"],
    threadOrder: ["alpha-thread", "beta-thread"],
    blockOrder: ["alpha", "other"],
    blockPlacementOrder: ["alpha-place", "other-place"],
    projects: {
      "alpha-project": {
        id: "alpha-project",
        name: "Alpha Project",
        categoryId: "tools",
      },
      "beta-project": {
        id: "beta-project",
        name: "Beta Project",
        categoryId: "games",
      },
    },
    threads: {
      "alpha-thread": {
        id: "alpha-thread",
        name: "Alpha Thread",
        projectId: "alpha-project",
      },
      "beta-thread": {
        id: "beta-thread",
        name: "Beta Thread",
        projectId: "beta-project",
      },
    },
    blocks: {
      alpha: { id: "alpha", text: "Alpha" },
      other: { id: "other", text: "Other" },
    },
    blockPlacements: {
      "alpha-place": {
        id: "alpha-place",
        blockId: "alpha",
        threadId: "alpha-thread",
        strictTies: { before: null, after: null },
      },
      "other-place": {
        id: "other-place",
        blockId: "other",
        threadId: "beta-thread",
        strictTies: { before: null, after: null },
      },
    },
  }));

  assert.equal(migrated.version, 5);
  assert.deepEqual(migrated.linearSequenceOrder, ["linear-alpha-project", "linear-beta-project"]);
  assert.deepEqual(migrated.linearSequences["linear-alpha-project"].entryOrder, []);
  assert.deepEqual(migrated.linearSequences["linear-beta-project"].entryOrder, []);
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

  assert.equal(migrated.version, 5);
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

  assert.equal(migrated.version, 5);
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
