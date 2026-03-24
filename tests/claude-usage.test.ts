import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "../src/main/defaults.ts";
import { ClaudeService } from "../src/main/services/claude-service.ts";
import {
  buildClaudeUsageProbeSettingsArg,
  parseClaudeStatusLineUsageWindows,
} from "../src/main/utils/claude-usage.ts";

test("buildClaudeUsageProbeSettingsArg installs a temporary status line capture command", () => {
  const settingsArg = JSON.parse(buildClaudeUsageProbeSettingsArg());

  assert.equal(settingsArg.effortLevel, "low");
  assert.deepEqual(settingsArg.statusLine, {
    type: "command",
    command: 'cat > "$PROGRAMS_CLAUDE_RATE_LIMITS_FILE"',
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

test("Claude usage falls back to activity history when live rate limits are unavailable", async () => {
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
    readUsageWindows: async () => null,
    readStatsCache: async () => ({
      lastComputedDate: "2026-03-19",
      dailyActivity: [
        {
          date: "2026-03-19",
          messageCount: 4,
          sessionCount: 1,
          toolCallCount: 2,
        },
      ],
      dailyModelTokens: [
        {
          date: "2026-03-19",
          tokensByModel: {
            sonnet: 1234,
          },
        },
      ],
      totalSessions: 1,
      totalMessages: 4,
      firstSessionDate: "2026-03-19",
    }),
  });

  const usage = await service.getUsage(DEFAULT_SETTINGS);

  assert.equal(usage.status, "ready");
  assert.deepEqual(
    usage.windows.map((window) => ({
      label: window.label,
      usedPercent: window.usedPercent,
      windowDurationMins: window.windowDurationMins,
    })),
    [
      {
        label: "Recent (5h)",
        usedPercent: null,
        windowDurationMins: 300,
      },
      {
        label: "This Week",
        usedPercent: null,
        windowDurationMins: 7 * 24 * 60,
      },
    ],
  );
  assert.match(usage.note ?? "", /activity history/i);
});
