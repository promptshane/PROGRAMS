import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyAuth, emptyUsage } from "../src/renderer/src/lib/constants";
import {
  buildUsageTriggerProviderGroups,
  getUsageTriggerDotColor,
  UsageTriggerButton,
} from "../src/renderer/src/components/usage-trigger";
import type { UsageSnapshot, UsageWindow } from "../src/shared/types";

const makeWindow = (_providerLabel: "Claude" | "Codex", windowDurationMins: 300 | 10080, usedPercent: number): UsageWindow => ({
  label: windowDurationMins === 300 ? "5-hour window" : "7-day window",
  usedPercent,
  valueLabel: null,
  detail: null,
  resetsAt: new Date(Date.now() + (windowDurationMins / 2) * 60_000).toISOString(),
  windowDurationMins,
});

const makeUsage = (claudeWindows: UsageWindow[], codexWindows: UsageWindow[]): UsageSnapshot => ({
  ...emptyUsage,
  updatedAt: new Date().toISOString(),
  claude: {
    ...emptyUsage.claude,
    status: "ready",
    windows: claudeWindows,
    note: null,
  },
  codex: {
    ...emptyUsage.codex,
    status: "ready",
    windows: codexWindows,
    note: null,
  },
});

const makeAuth = (claudeLoggedIn: boolean, codexLoggedIn: boolean) => ({
  ...emptyAuth,
  claude: {
    ...emptyAuth.claude,
    loggedIn: claudeLoggedIn,
  },
  codex: {
    ...emptyAuth.codex,
    loggedIn: codexLoggedIn,
  },
});

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

test("getUsageTriggerDotColor maps schedule tone to green, yellow, and red", () => {
  const green = makeWindow("Claude", 300, 30);
  const yellow = makeWindow("Claude", 300, 50);
  const red = makeWindow("Claude", 300, 70);

  assert.equal(getUsageTriggerDotColor(green), "green");
  assert.equal(getUsageTriggerDotColor(yellow), "yellow");
  assert.equal(getUsageTriggerDotColor(red), "red");
  assert.equal(getUsageTriggerDotColor(null), "yellow");
});

test("Usage trigger dots stay ordered Claude first, then Codex, with 5-hour before 7-day", () => {
  const usage = makeUsage(
    [makeWindow("Claude", 300, 30), makeWindow("Claude", 10080, 50)],
    [makeWindow("Codex", 300, 70), makeWindow("Codex", 10080, 30)],
  );
  const groups = buildUsageTriggerProviderGroups(usage, makeAuth(true, true));

  assert.deepEqual(
    groups.map((group) => ({
      provider: group.provider,
      windowDurations: group.dots.map((dot) => dot.windowDurationMins),
      colors: group.dots.map((dot) => dot.color),
    })),
    [
      {
        provider: "claude",
        windowDurations: [300, 10080],
        colors: ["green", "yellow"],
      },
      {
        provider: "codex",
        windowDurations: [300, 10080],
        colors: ["red", "green"],
      },
    ],
  );
});

test("UsageTriggerButton renders two dots when only one provider is logged in", () => {
  const usage = makeUsage(
    [makeWindow("Claude", 300, 30), makeWindow("Claude", 10080, 50)],
    [makeWindow("Codex", 300, 70), makeWindow("Codex", 10080, 30)],
  );

  const markup = renderToStaticMarkup(
    createElement(UsageTriggerButton, {
      auth: makeAuth(true, false),
      usage,
      onClick: () => undefined,
    }),
  );

  assert.equal(countMatches(markup, /class="sysHealthDot\b/g), 2);
  assert.equal(countMatches(markup, /usageTriggerDivider/g), 0);
  assert.match(markup, /usageTriggerProviderGroup--claude/);
  assert.doesNotMatch(markup, /usageTriggerProviderGroup--codex/);
  assert.match(markup, /aria-label="Open usage overview for Claude"/);
  assert.match(markup, />Usage</);
});

test("UsageTriggerButton renders four dots with a divider when both providers are logged in", () => {
  const usage = makeUsage(
    [makeWindow("Claude", 300, 30), makeWindow("Claude", 10080, 50)],
    [makeWindow("Codex", 300, 70), makeWindow("Codex", 10080, 30)],
  );

  const markup = renderToStaticMarkup(
    createElement(UsageTriggerButton, {
      auth: makeAuth(true, true),
      usage,
      onClick: () => undefined,
    }),
  );

  assert.equal(countMatches(markup, /class="sysHealthDot\b/g), 4);
  assert.equal(countMatches(markup, /usageTriggerDivider/g), 1);
  assert.match(markup, /usageTriggerProviderGroup--claude/);
  assert.match(markup, /usageTriggerProviderGroup--codex/);
  assert.match(markup, /aria-label="Open usage overview for Claude and Codex"/);
});
