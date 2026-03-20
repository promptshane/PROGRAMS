import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_CATALOG } from "../src/shared/types.ts";
import { selectPreferredCodexModels } from "../src/main/utils/codex-model-catalog.ts";
import { buildSlackResponseContract } from "../src/main/utils/slack-flow.ts";
import {
  danSlackSchema,
  directorSlackSchema,
  refreshMappingSchema,
  refreshScanSchema,
  researchSlackSchema,
} from "../src/main/utils/slack-schema.ts";

test("Slack strict schemas require every declared property", () => {
  const schemaPairs = [
    ["dan", danSlackSchema],
    ["director", directorSlackSchema],
    ["research", researchSlackSchema],
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

test("Slack response contract stays synchronized with standard and research schemas", () => {
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
  ] as const;

  for (const { contract, required } of contracts) {
    const fields = [...contract.matchAll(/"([^"]+)":/g)].map((match) => match[1]!).sort();
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
  assert.ok(contract.includes('"conversationStatus"'));
  assert.ok(contract.includes('"draftCoreDetails"'));
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
