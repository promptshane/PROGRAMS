import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_CATALOG } from "../src/shared/types.ts";
import { selectPreferredCodexModels } from "../src/main/utils/codex-model-catalog.ts";
import { buildSlackResponseContract } from "../src/main/utils/slack-flow.ts";
import {
  directorPongCompareSchema,
  directorPongGoalSchema,
  directorPongTestSchema,
  directorPingSchema,
  directorPmSchema,
  directorToddResearchSchema,
  directorToddUpdateSchema,
  directorToddVersionSchema,
} from "../src/main/utils/director-chat-schema.ts";
import {
  danSlackSchema,
  directorSlackSchema,
  pingSlackSchema,
  refreshMappingSchema,
  refreshScanSchema,
  researchSlackSchema,
  toddUpdateSlackSchema,
  toddVersionSlackSchema,
} from "../src/main/utils/slack-schema.ts";

test("Slack strict schemas require every declared property", () => {
  const schemaPairs = [
    ["dan", danSlackSchema],
    ["director", directorSlackSchema],
    ["ping", pingSlackSchema],
    ["research", researchSlackSchema],
    ["todd-version", toddVersionSlackSchema],
    ["todd-update", toddUpdateSlackSchema],
    ["refresh-scan", refreshScanSchema],
    ["refresh-mapping", refreshMappingSchema],
  ] as const;

  for (const [label, schema] of schemaPairs) {
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
      `${label} schema required keys should match declared properties`,
    );
  }
});

test("Director DM strict schemas require every declared property", () => {
  const schemaPairs = [
    ["pm", directorPmSchema],
    ["todd-research", directorToddResearchSchema],
    ["todd-version", directorToddVersionSchema],
    ["todd-update", directorToddUpdateSchema],
    ["ping", directorPingSchema],
    ["pong-goal", directorPongGoalSchema],
    ["pong-test", directorPongTestSchema],
    ["pong-compare", directorPongCompareSchema],
  ] as const;

  for (const [label, schema] of schemaPairs) {
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
      `${label} schema required keys should match declared properties`,
    );
  }
});

test("Todd nested planning schemas require every declared item property", () => {
  const dmResearchItem = directorToddResearchSchema.properties.feasibilityAssessments.items;
  const dmVersionItem = directorToddVersionSchema.properties.versions.items;
  const dmUpdateItem = directorToddUpdateSchema.properties.updates.items;
  const slackVersionItem = toddVersionSlackSchema.properties.versions.items;
  const slackUpdateItem = toddUpdateSlackSchema.properties.updates.items;

  assert.deepEqual(
    [...dmResearchItem.required].sort(),
    Object.keys(dmResearchItem.properties).sort(),
  );
  assert.deepEqual(
    [...dmVersionItem.required].sort(),
    Object.keys(dmVersionItem.properties).sort(),
  );
  assert.deepEqual(
    [...dmUpdateItem.required].sort(),
    Object.keys(dmUpdateItem.properties).sort(),
  );
  assert.deepEqual(
    [...slackVersionItem.required].sort(),
    Object.keys(slackVersionItem.properties).sort(),
  );
  assert.deepEqual(
    [...slackUpdateItem.required].sort(),
    Object.keys(slackUpdateItem.properties).sort(),
  );
});

test("Slack response contract stays synchronized with standard and specialized schemas", () => {
  const contracts = [
    {
      contract: buildSlackResponseContract("creative-director", "codebase-analysis"),
      required: [...danSlackSchema.required].sort(),
    },
    {
      contract: buildSlackResponseContract("project-manager", "codebase-analysis"),
      required: [...directorSlackSchema.required].sort(),
    },
    {
      contract: buildSlackResponseContract("rd-director", "internet-research"),
      required: [...researchSlackSchema.required].sort(),
    },
    {
      contract: buildSlackResponseContract("rd-director", "version-planning"),
      required: [...toddVersionSlackSchema.required].sort(),
    },
    {
      contract: buildSlackResponseContract("rd-director", "update-planning"),
      required: [...toddUpdateSlackSchema.required].sort(),
    },
  ] as const;

  for (const { contract, required } of contracts) {
    const fields = [...contract.matchAll(/^- "([^"]+)":/gm)].map((match) => match[1]!).sort();
    assert.deepEqual(fields, required);
  }
});

test("Todd codebase-analysis contract does not ask for research-only summaries", () => {
  const contract = buildSlackResponseContract("rd-director", "codebase-analysis");

  assert.ok(!contract.includes('"generalSummary"'));
  assert.ok(!contract.includes('"projectSummary"'));
});

test("Dan contract includes notes and draft lifecycle fields", () => {
  const contract = buildSlackResponseContract("creative-director", "codebase-analysis");

  assert.ok(contract.includes('"notesToAppend"'));
  assert.ok(contract.includes('"rawMemoriesToAppend"'));
  assert.ok(contract.includes('"conversationStatus"'));
  assert.ok(contract.includes('"draftChangeSummary"'));
  assert.ok(contract.includes('"draftOperations"'));
  assert.ok(contract.includes('"draftCoreDetails"'));
  assert.ok(contract.includes('"presenceAction"'));
});

test("Todd planning contracts include confirmation and plan arrays", () => {
  const versionContract = buildSlackResponseContract("rd-director", "version-planning");
  const updateContract = buildSlackResponseContract("rd-director", "update-planning");

  assert.ok(versionContract.includes('"confirmationSuggested"'));
  assert.ok(versionContract.includes('"versions"'));
  assert.ok(updateContract.includes('"confirmationSuggested"'));
  assert.ok(updateContract.includes('"updates"'));
});

test("Todd DM schemas include routing and memory fields across planning modes", () => {
  for (const schema of [directorToddResearchSchema, directorToddVersionSchema, directorToddUpdateSchema]) {
    assert.ok(schema.required.includes("handoffTo"));
    assert.ok(schema.required.includes("handoffReason"));
    assert.ok(schema.required.includes("currentState"));
    assert.ok(schema.required.includes("idealState"));
    assert.ok(schema.required.includes("notesToAppend"));
  }
});

test("Codex model selection keeps GPT-5.4 alongside GPT-5.4 Mini", () => {
  const selected = selectPreferredCodexModels([
    {
      model: "gpt-5.4",
      displayName: "gpt-5.4",
      description: "Latest frontier agentic coding model.",
      hidden: false,
    },
    {
      model: "gpt-5.4-mini",
      displayName: "GPT-5.4-Mini",
      description: "Smaller frontier agentic coding model.",
      hidden: false,
    },
    {
      model: "gpt-5.3-codex",
      displayName: "gpt-5.3-codex",
      description: "Frontier Codex-optimized agentic coding model.",
      hidden: false,
    },
    {
      model: "gpt-5.2",
      displayName: "gpt-5.2",
      description: "Optimized for professional work and long-running agents",
      hidden: false,
    },
  ]);

  assert.deepEqual(
    selected.map((option) => option.id),
    ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
  );
});

test("Fallback Codex model catalog includes GPT-5.4, GPT-5.4 Mini, and GPT-5.3 Codex", () => {
  assert.deepEqual(
    DEFAULT_MODEL_CATALOG.codex.map((option) => option.id),
    ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
  );
});
