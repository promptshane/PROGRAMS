import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProjectOutlineReport,
  parseEnvEntries,
  parseProjectOutlineReportResponse,
  serializeEnvEntries,
} from "../src/main/utils/project-outline.ts";

test("parseProjectOutlineReportResponse normalizes nested stored data and dedupes env keys", () => {
  const report = parseProjectOutlineReportResponse(
    "project-1",
    `\`\`\`json
    {
      "storedData": [
        {
          "label": "User profiles",
          "description": "Saved customer account data.",
          "children": [
            { "label": "Display name", "description": "Shown in the UI.", "children": [] }
          ]
        }
      ],
      "connections": [
        {
          "name": "OpenAI",
          "kind": "API",
          "description": "Handles text generation.",
          "envKeys": ["OPENAI_API_KEY", "OPENAI_API_KEY"]
        }
      ],
      "costs": [
        {
          "label": "Model usage",
          "amount": "Variable",
          "description": "Depends on token volume."
        }
      ],
      "referencedEnvKeys": ["OPENAI_API_KEY", "STRIPE_SECRET_KEY"]
    }
    \`\`\``,
  );

  assert.equal(report.projectId, "project-1");
  assert.equal(report.storedData.length, 1);
  assert.equal(report.storedData[0]?.children[0]?.label, "Display name");
  assert.deepEqual(report.connections[0]?.envKeys, ["OPENAI_API_KEY"]);
  assert.deepEqual(report.referencedEnvKeys, ["OPENAI_API_KEY", "STRIPE_SECRET_KEY"]);
});

test("normalizeProjectOutlineReport tolerates malformed payloads", () => {
  const report = normalizeProjectOutlineReport("project-2", {
    storedData: [{ label: "Cache", children: [{ nope: true }] }],
    connections: [{ name: "Supabase" }],
    costs: [{ label: "Database" }],
    referencedEnvKeys: ["SUPABASE_URL", "", "SUPABASE_URL"],
  });

  assert.equal(report.storedData.length, 1);
  assert.equal(report.storedData[0]?.children.length, 0);
  assert.equal(report.connections[0]?.description, "Connected service detected in the project.");
  assert.equal(report.costs[0]?.description, "Estimated usage and cost note.");
  assert.deepEqual(report.referencedEnvKeys, ["SUPABASE_URL"]);
});

test("parseEnvEntries reads quoted values and last duplicate wins", () => {
  const entries = parseEnvEntries(`
    # Comment
    OPENAI_API_KEY="secret value"
    export PORT=3000
    OPENAI_API_KEY=latest
  `);

  assert.deepEqual(entries, [
    { key: "OPENAI_API_KEY", value: "latest" },
    { key: "PORT", value: "3000" },
  ]);
});

test("serializeEnvEntries validates keys and quotes complex values", () => {
  const output = serializeEnvEntries([
    { key: "OPENAI_API_KEY", value: "secret value" },
    { key: "PORT", value: "3000" },
  ]);

  assert.equal(output, 'OPENAI_API_KEY="secret value"\nPORT=3000\n');
  assert.throws(
    () =>
      serializeEnvEntries([
        { key: "BAD KEY", value: "x" },
      ]),
    /not a valid environment variable key/i,
  );
});
