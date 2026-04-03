import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_CATALOG } from "../src/shared/types.ts";
import { selectPreferredCodexModels } from "../src/main/utils/codex-model-catalog.ts";
import { buildAgentChatResponseContract } from "../src/main/utils/agent-chat-flow.ts";
import {
  directorPongCompareSchema,
  directorPongGoalSchema,
  directorPongTestSchema,
  directorPingSchema,
  directorPmSchema,
  directorToddReviewSchema,
  directorToddResearchSchema,
  directorToddUpdateSchema,
  directorToddVersionSchema,
} from "../src/main/utils/director-chat-schema.ts";
import {
  danAgentChatSchema,
  directorAgentChatSchema,
  pingAgentChatSchema,
  refreshMappingSchema,
  refreshScanSchema,
  researchAgentChatSchema,
  toddUpdateAgentChatSchema,
  toddVersionAgentChatSchema,
} from "../src/main/utils/agent-chat-schema.ts";

test("Agent chat strict schemas require every declared property", () => {
  const schemaPairs = [
    ["dan", danAgentChatSchema],
    ["director", directorAgentChatSchema],
    ["ping", pingAgentChatSchema],
    ["research", researchAgentChatSchema],
    ["todd-version", toddVersionAgentChatSchema],
    ["todd-update", toddUpdateAgentChatSchema],
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
  const agentChatVersionItem = toddVersionAgentChatSchema.properties.versions.items;
  const agentChatUpdateItem = toddUpdateAgentChatSchema.properties.updates.items;

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
    [...agentChatVersionItem.required].sort(),
    Object.keys(agentChatVersionItem.properties).sort(),
  );
  assert.deepEqual(
    [...agentChatUpdateItem.required].sort(),
    Object.keys(agentChatUpdateItem.properties).sort(),
  );
});

test("Agent chat response contract stays synchronized with standard and specialized schemas", () => {
  const contracts = [
    {
      contract: buildAgentChatResponseContract("creative-director", "codebase-analysis"),
      required: [...danAgentChatSchema.required].sort(),
    },
    {
      contract: buildAgentChatResponseContract("project-manager", "codebase-analysis"),
      required: [...directorAgentChatSchema.required].sort(),
    },
    {
      contract: buildAgentChatResponseContract("rd-director", "internet-research"),
      required: [...researchAgentChatSchema.required].sort(),
    },
    {
      contract: buildAgentChatResponseContract("rd-director", "version-planning"),
      required: [...toddVersionAgentChatSchema.required].sort(),
    },
    {
      contract: buildAgentChatResponseContract("rd-director", "update-planning"),
      required: [...toddUpdateAgentChatSchema.required].sort(),
    },
  ] as const;

  for (const { contract, required } of contracts) {
    const fields = [...contract.matchAll(/^- "([^"]+)":/gm)].map((match) => match[1]!).sort();
    assert.deepEqual(fields, required);
  }
});

test("Todd codebase-analysis contract does not ask for research-only summaries", () => {
  const contract = buildAgentChatResponseContract("rd-director", "codebase-analysis");

  assert.ok(!contract.includes('"generalSummary"'));
  assert.ok(!contract.includes('"projectSummary"'));
});

test("Dan contract includes notes and draft lifecycle fields", () => {
  const contract = buildAgentChatResponseContract("creative-director", "codebase-analysis");

  assert.ok(contract.includes('"notesToAppend"'));
  assert.ok(contract.includes('"rawMemoriesToAppend"'));
  assert.ok(contract.includes('"conversationStatus"'));
  assert.ok(contract.includes('"draftChangeSummary"'));
  assert.ok(contract.includes('"draftOperations"'));
  assert.ok(contract.includes('"draftCoreDetails"'));
  assert.ok(contract.includes('"presenceAction"'));
});

test("Todd planning contracts include confirmation and plan arrays", () => {
  const versionContract = buildAgentChatResponseContract("rd-director", "version-planning");
  const updateContract = buildAgentChatResponseContract("rd-director", "update-planning");

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

test("Todd review schema includes structural replan fields", () => {
  for (const field of ["replanNeeded", "replanReason", "replanCurrentState", "replanIdealState", "replanUpdates"]) {
    assert.ok(directorToddReviewSchema.required.includes(field));
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
