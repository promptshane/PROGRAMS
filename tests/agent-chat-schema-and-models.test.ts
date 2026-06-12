import assert from "node:assert/strict";
import test from "node:test";
import * as agentChatSchemaExports from "../src/main/utils/agent-chat-schema.ts";
import * as directorChatSchemaExports from "../src/main/utils/director-chat-schema.ts";
import * as sharedSchemaExports from "../src/main/utils/shared-schema.ts";
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

type SchemaObject = {
  required?: readonly string[];
  properties?: Record<string, unknown>;
  items?: unknown;
};

const isSchemaRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const assertSchemaRequiredMatchesProperties = (schema: SchemaObject, label: string): void => {
  assert.ok(isSchemaRecord(schema.properties), `${label} should declare object properties`);
  assert.ok(Array.isArray(schema.required), `${label} should declare required keys`);
  assert.deepEqual(
    [...schema.required!].sort(),
    Object.keys(schema.properties!).sort(),
    `${label} required keys should match declared properties`,
  );
};

const assertStrictSchemaRecursively = (
  schema: unknown,
  label: string,
  seen: Set<unknown> = new Set(),
): void => {
  if (!isSchemaRecord(schema) || seen.has(schema)) {
    return;
  }
  seen.add(schema);

  if (isSchemaRecord(schema.properties)) {
    assertSchemaRequiredMatchesProperties(schema, label);
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      assertStrictSchemaRecursively(childSchema, `${label}.properties.${key}`, seen);
    }
  }

  if (Array.isArray(schema.items)) {
    for (const [index, itemSchema] of schema.items.entries()) {
      assertStrictSchemaRecursively(itemSchema, `${label}.items[${index}]`, seen);
    }
  } else if (schema.items !== undefined) {
    assertStrictSchemaRecursively(schema.items, `${label}.items`, seen);
  }
};

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

test("Exported agent, director, and shared schemas stay strict recursively", () => {
  const schemaModules = [
    ["agent", agentChatSchemaExports],
    ["director", directorChatSchemaExports],
    ["shared", sharedSchemaExports],
  ] as const;

  for (const [moduleLabel, schemaExports] of schemaModules) {
    for (const [exportName, schema] of Object.entries(schemaExports)) {
      if (isSchemaRecord(schema) && schema.type === "object") {
        assertStrictSchemaRecursively(schema, `${moduleLabel}.${exportName}`);
      }
    }
  }
});

test("Known nested schema regressions keep required keys aligned", () => {
  assertSchemaRequiredMatchesProperties(
    danAgentChatSchema.properties.draftOperations.items as SchemaObject,
    "danAgentChatSchema.properties.draftOperations.items",
  );
  assertSchemaRequiredMatchesProperties(
    danAgentChatSchema.properties.draftOperations.items.properties.threadMemberships.items as SchemaObject,
    "danAgentChatSchema.properties.draftOperations.items.properties.threadMemberships.items",
  );
  assertSchemaRequiredMatchesProperties(
    refreshMappingSchema.properties.currentCorePillars.items as SchemaObject,
    "refreshMappingSchema.properties.currentCorePillars.items",
  );
  assertSchemaRequiredMatchesProperties(
    refreshMappingSchema.properties.currentCorePillars.items.properties.children.items as SchemaObject,
    "refreshMappingSchema.properties.currentCorePillars.items.properties.children.items",
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

test("Codex model selection keeps GPT-5.5 alongside GPT-5.5 Mini", () => {
  const selected = selectPreferredCodexModels([
    {
      model: "gpt-5.5",
      displayName: "gpt-5.5",
      description: "Latest frontier agentic coding model.",
      hidden: false,
    },
    {
      model: "gpt-5.5-mini",
      displayName: "GPT-5.5-Mini",
      description: "Smaller frontier agentic coding model.",
      hidden: false,
    },
    {
      model: "gpt-5.4-codex",
      displayName: "gpt-5.4-codex",
      description: "Frontier Codex-optimized agentic coding model.",
      hidden: false,
    },
    {
      model: "gpt-5.4",
      displayName: "gpt-5.4",
      description: "Optimized for professional work and long-running agents",
      hidden: false,
    },
  ]);

  assert.deepEqual(
    selected.map((option) => option.id),
    ["gpt-5.5", "gpt-5.5-mini"],
  );
});

test("Fallback Codex model catalog includes GPT-5.5 and GPT-5.5 Mini", () => {
  assert.deepEqual(
    DEFAULT_MODEL_CATALOG.codex.map((option) => option.id),
    ["gpt-5.5", "gpt-5.5-mini"],
  );
});
