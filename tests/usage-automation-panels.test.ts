import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const usagePanelSource = readFileSync(
  new URL("../src/renderer/src/components/usage-panel.tsx", import.meta.url),
  "utf8",
);
const automationPanelSource = readFileSync(
  new URL("../src/renderer/src/components/automation-panel.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/renderer/src/App.tsx", import.meta.url),
  "utf8",
);

test("UsageOverviewSheet contains usage controls without automation content", () => {
  assert.match(usagePanelSource, /Modal title="Usage"/);
  assert.match(usagePanelSource, /Agent Provider/);
  assert.match(usagePanelSource, /usageCardGrid/);
  assert.doesNotMatch(usagePanelSource, /usageAutomationSection/);
  assert.doesNotMatch(usagePanelSource, /Automation note/);
});

test("AutomationOverviewSheet owns the automation controls without usage cards", () => {
  assert.match(automationPanelSource, /Modal title="Automation"/);
  assert.match(automationPanelSource, /Automation note/);
  assert.match(automationPanelSource, /Pause at usage %/);
  assert.match(automationPanelSource, /Included projects/);
  assert.doesNotMatch(automationPanelSource, /usageCardGrid/);
  assert.doesNotMatch(automationPanelSource, /Agent Provider/);
});

test("sidebar Automation and upper-right Usage triggers use independent handlers", () => {
  assert.match(appSource, /aria-label="Open auto"[\s\S]*?<TimerIcon \/>[\s\S]*?<span>Auto<\/span>/);
  assert.match(appSource, /onClick=\{toggleAutomationSheet\}/);
  assert.doesNotMatch(appSource, /aria-label="Open auto"[\s\S]{0,300}toggleUsageSheet/);

  const usageTriggerCalls = appSource.match(
    /<UsageTriggerButton[\s\S]*?onClick=\{toggleUsageSheet\}[\s\S]*?\/>/g,
  ) ?? [];
  assert.ok(usageTriggerCalls.length >= 3);
});

test("Settings, Usage, and Automation sheets close one another when opened", () => {
  const usageHandler = appSource.match(/const toggleUsageSheet = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  const automationHandler = appSource.match(/const toggleAutomationSheet = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
  const settingsHandler = appSource.match(/const openSettingsModal = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";

  assert.match(usageHandler, /setShowSettings\(false\)/);
  assert.match(usageHandler, /setShowAutomationSheet\(false\)/);
  assert.match(automationHandler, /setShowSettings\(false\)/);
  assert.match(automationHandler, /setShowUsageSheet\(false\)/);
  assert.match(settingsHandler, /setShowUsageSheet\(false\)/);
  assert.match(settingsHandler, /setShowAutomationSheet\(false\)/);
});
