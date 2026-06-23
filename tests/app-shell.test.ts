import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_PAGE_OPTIONS,
  getVisibleAppPageOptions,
  resolveVisibleAppPage,
} from "../src/shared/app-shell.ts";

test("Agents is visible in the app shell", () => {
  const visiblePageIds = getVisibleAppPageOptions().map((page) => page.id);
  assert.equal(visiblePageIds.includes("agents"), true);
  assert.equal(resolveVisibleAppPage("agents"), "agents");
  assert.equal(APP_PAGE_OPTIONS.some((page) => page.id === "agents"), true);
});

test("Systems Syntax is directly beneath Homepage", () => {
  const visiblePages = getVisibleAppPageOptions();
  assert.deepEqual(
    visiblePages.slice(0, 2).map((page) => page.id),
    ["homepage", "systems-syntax"],
  );
  assert.equal(resolveVisibleAppPage("systems-syntax"), "systems-syntax");
});
