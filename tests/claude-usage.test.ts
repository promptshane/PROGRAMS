import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/main/defaults.ts";
import { ClaudeService } from "../src/main/services/claude-service.ts";
import {
  buildClaudeUsageProbeSettingsArg,
  type ClaudeUsageWindowData,
  parseClaudeStatusLineUsageWindows,
} from "../src/main/utils/claude-usage.ts";

test("buildClaudeUsageProbeSettingsArg installs a temporary status line capture command", () => {
  const settingsArg = JSON.parse(buildClaudeUsageProbeSettingsArg());

  assert.equal(settingsArg.effortLevel, "low");
  assert.deepEqual(settingsArg.statusLine, {
    type: "command",
    command: `/bin/sh -c 'cat >> "$PROGRAMS_CLAUDE_RATE_LIMITS_FILE"; printf "\\n" >> "$PROGRAMS_CLAUDE_RATE_LIMITS_FILE"'`,
    padding: 0,
  });
});

test("parseClaudeStatusLineUsageWindows reads Claude.ai 5-hour and 7-day windows", () => {
  const windows = parseClaudeStatusLineUsageWindows(
    JSON.stringify({
      rate_limits: {
        five_hour: {
          used_percentage: 23.5,
          resets_at: 1_738_425_600,
        },
        seven_day: {
          used_percentage: 41.2,
          resets_at: 1_738_857_600,
        },
      },
    }),
  );

  assert.deepEqual(windows, [
    {
      label: "5-hour window",
      usedPercent: 24,
      resetsAt: new Date(1_738_425_600 * 1000).toISOString(),
      windowDurationMins: 300,
    },
    {
      label: "7-day window",
      usedPercent: 41,
      resetsAt: new Date(1_738_857_600 * 1000).toISOString(),
      windowDurationMins: 7 * 24 * 60,
    },
  ]);
});

test("parseClaudeStatusLineUsageWindows returns null when rate limits are absent", () => {
  const windows = parseClaudeStatusLineUsageWindows(JSON.stringify({ cwd: "/tmp" }));

  assert.equal(windows, null);
});

test("parseClaudeStatusLineUsageWindows reads the latest rate-limit payload from appended status lines", () => {
  const windows = parseClaudeStatusLineUsageWindows(
    [
      JSON.stringify({
        cwd: "/tmp",
        context_window: {
          used_percentage: 8,
        },
      }),
      JSON.stringify({
        rate_limits: {
          five_hour: {
            used_percentage: 12,
            resets_at: 1_774_598_400,
          },
          seven_day: {
            used_percentage: 58,
            resets_at: 1_774_724_400,
          },
        },
      }),
    ].join("\n"),
  );

  assert.deepEqual(windows, [
    {
      label: "5-hour window",
      usedPercent: 12,
      resetsAt: new Date(1_774_598_400 * 1000).toISOString(),
      windowDurationMins: 300,
    },
    {
      label: "7-day window",
      usedPercent: 58,
      resetsAt: new Date(1_774_724_400 * 1000).toISOString(),
      windowDurationMins: 7 * 24 * 60,
    },
  ]);
});

test("Claude usage stays unavailable when live rate limits are unavailable", async () => {
  const service = new ClaudeService(() => undefined);

  const auth = {
    available: true,
    loggedIn: true,
    ready: true,
    canConnect: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.80",
    email: "user@example.com",
    displayName: "User",
    planType: "Subscription",
    errorMessage: null,
    runtimeErrorMessage: null,
    connectErrorMessage: null,
  };

  Object.assign(service as any, {
    getAuthStatus: async () => auth,
    readUsageWindows: async () => ({
      windows: null,
      note: null,
    }),
  });

  const usage = await service.getUsage(DEFAULT_SETTINGS);

  assert.equal(usage.status, "unsupported");
  assert.equal(usage.windows.length, 0);
  assert.match(usage.note ?? "", /unavailable/i);
});

test("Claude usage returns live windows when the PTY probe captures rate limits", async () => {
  const service = new ClaudeService(() => undefined);

  const auth = {
    available: true,
    loggedIn: true,
    ready: true,
    canConnect: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.80",
    email: "user@example.com",
    displayName: "User",
    planType: "Subscription",
    errorMessage: null,
    runtimeErrorMessage: null,
    connectErrorMessage: null,
  };

  const liveWindows: ClaudeUsageWindowData[] = [
    {
      label: "5-hour window",
      usedPercent: 24,
      resetsAt: "2026-03-27T12:00:00.000Z",
      windowDurationMins: 300,
    },
    {
      label: "7-day window",
      usedPercent: 41,
      resetsAt: "2026-03-30T12:00:00.000Z",
      windowDurationMins: 7 * 24 * 60,
    },
  ];

  Object.assign(service as any, {
    getAuthStatus: async () => auth,
    readUsageWindows: async () => ({
      windows: liveWindows,
      note: null,
    }),
  });

  const usage = await service.getUsage(DEFAULT_SETTINGS);

  assert.equal(usage.status, "ready");
  assert.deepEqual(
    usage.windows.map((window) => ({
      label: window.label,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt,
      windowDurationMins: window.windowDurationMins,
    })),
    liveWindows,
  );
  assert.equal(usage.note, null);
});

test("Claude usage explains when first-run terminal setup blocks the live PTY probe", async () => {
  const service = new ClaudeService(() => undefined);

  const auth = {
    available: true,
    loggedIn: true,
    ready: true,
    canConnect: true,
    binaryPath: "/usr/local/bin/claude",
    version: "2.1.80",
    email: "user@example.com",
    displayName: "User",
    planType: "Subscription",
    errorMessage: null,
    runtimeErrorMessage: null,
    connectErrorMessage: null,
  };

  Object.assign(service as any, {
    getAuthStatus: async () => auth,
    readUsageWindows: async () => ({
      windows: null,
      note: "Complete Claude Code's first-run terminal setup once in a real terminal to enable live usage bars in PROGRAMS.",
    }),
  });

  const usage = await service.getUsage(DEFAULT_SETTINGS);

  assert.equal(usage.status, "unsupported");
  assert.equal(usage.windows.length, 0);
  assert.match(usage.note ?? "", /first-run terminal setup/i);
});
