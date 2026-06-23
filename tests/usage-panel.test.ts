import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { emptyUsage } from "../src/renderer/src/lib/constants";
import type { AiProvider, UsageSnapshot, UsageWindow } from "../src/shared/types";

type UsageOverviewSheetProps = {
  provider: AiProvider;
  usage: UsageSnapshot;
  usageRefreshing: boolean;
  providerBusy: boolean;
  onProviderChange: (provider: AiProvider) => void;
  onClose: () => void;
};

type UsagePanelExports = {
  UsageOverviewSheet: ComponentType<UsageOverviewSheetProps>;
};

const realRequire = createRequire(import.meta.url);

const loadUsagePanelExports = (): UsagePanelExports => {
  const source = readFileSync(
    new URL("../src/renderer/src/components/usage-panel.tsx", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
    },
  });

  const module = { exports: {} as Record<string, unknown> };
  const stubRequire = (specifier: string): unknown => {
    switch (specifier) {
      case "react/jsx-runtime":
        return realRequire("react/jsx-runtime");
      case "./ui-primitives":
        return {
          Modal: ({ title, children }: { title: string; children: ReactNode }) =>
            createElement("section", { "data-modal-title": title }, children),
        };
      case "../lib/formatting":
        return {
          formatUsageDateTimeWithoutYear: () => "Jun 23, 4:00 PM",
          formatUsageReset: () => "Resets later",
        };
      case "../lib/constants":
        return { USAGE_SCHEDULE_TOLERANCE: 5 };
      case "../lib/session-helpers":
        return {
          computeExpectedPercent: () => null,
          getUsageScheduleTone: () => "onTrack",
        };
      default:
        return realRequire(specifier);
    }
  };

  vm.runInNewContext(
    outputText,
    {
      exports: module.exports,
      module,
      require: stubRequire,
    },
    { filename: "usage-panel.cjs" },
  );

  return module.exports as UsagePanelExports;
};

const { UsageOverviewSheet } = loadUsagePanelExports();

const makeWindow = (label: string, usedPercent: number): UsageWindow => ({
  label,
  usedPercent,
  valueLabel: null,
  detail: null,
  resetsAt: "2026-06-23T18:00:00.000Z",
  windowDurationMins: 300,
});

const makeUsage = (): UsageSnapshot => ({
  ...emptyUsage,
  updatedAt: "2026-06-23T16:00:00.000Z",
  claude: {
    status: "ready",
    windows: [makeWindow("Claude 5-hour window", 42)],
    note: null,
  },
  codex: {
    status: "ready",
    windows: [makeWindow("Codex 5-hour window", 37)],
    note: null,
  },
});

const renderUsageSheet = (usage: UsageSnapshot, usageRefreshing: boolean): string =>
  renderToStaticMarkup(
    createElement(UsageOverviewSheet, {
      provider: "codex",
      usage,
      usageRefreshing,
      providerBusy: false,
      onProviderChange: () => undefined,
      onClose: () => undefined,
    }),
  );

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

test("UsageOverviewSheet pulses both cards during refresh while keeping current metrics visible", () => {
  const markup = renderUsageSheet(makeUsage(), true);

  assert.equal(countMatches(markup, /usageCard-refreshing/g), 2);
  assert.equal(countMatches(markup, /aria-busy="true"/g), 2);
  assert.match(markup, /Claude 5-hour window/);
  assert.match(markup, /Codex 5-hour window/);
  assert.doesNotMatch(markup, /usageMetricList-loading/);
  assert.doesNotMatch(markup, /usagePreviewLabelPlaceholder/);
});

test("UsageOverviewSheet keeps initial empty snapshots in skeleton loading state", () => {
  const markup = renderUsageSheet(emptyUsage, true);

  assert.equal(countMatches(markup, /usageCard-loading/g), 2);
  assert.equal(countMatches(markup, /usageCard-refreshing/g), 2);
  assert.match(markup, /usagePreviewLabelPlaceholder/);
});
