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
