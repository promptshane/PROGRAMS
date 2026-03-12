import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileFlowchartGraph, normalizeFlowchartGraph, validateFlowchartGraph } from "../src/shared/flowchart.ts";
import { extractActionHintsFromText, extractNavigationHintsFromText } from "../src/shared/flowchart-hints.ts";
import type { FlowchartGraph } from "../src/shared/types.ts";

test("normalizeFlowchartGraph sanitizes ids and compileFlowchartGraph emits grouped Mermaid", () => {
  const graph: FlowchartGraph = {
    version: 1,
    direction: "TD",
    groups: [{ id: "Main Hub", label: "Main Hub", description: "Primary navigation" }],
    nodes: [
      {
        id: "Open Frames",
        label: "Open Frames",
        kind: "entry",
        description: "Launch the app.",
        groupId: null,
      },
      {
        id: "Projects Tab",
        label: "Projects",
        kind: "page",
        description: "Browse and open projects.",
        groupId: "Main Hub",
      },
      {
        id: "Save Project",
        label: "Save project",
        kind: "action",
        description: "Persist storyboard work locally.",
        groupId: "Main Hub",
      },
    ],
    edges: [
      { from: "Open Frames", to: "Projects Tab", label: null },
      { from: "Projects Tab", to: "Save Project", label: "next" },
    ],
  };

  const normalized = normalizeFlowchartGraph(graph);
  assert.ok(normalized);
  assert.equal(normalized?.groups[0]?.id, "main_hub");
  assert.equal(normalized?.nodes[0]?.id, "open_frames");
  assert.equal(normalized?.nodes[1]?.groupId, "main_hub");

  const mermaid = compileFlowchartGraph(graph);
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /subgraph cluster_main_hub\["Main Hub"\]/);
  assert.match(mermaid, /open_frames\(\["Open Frames"\]\)/);
  assert.match(mermaid, /projects_tab\["Projects"\]/);
  assert.match(mermaid, /save_project\("Save project"\)/);
});

test("validateFlowchartGraph flags slash-combined page labels", () => {
  const graph = normalizeFlowchartGraph({
    version: 1,
    direction: "TD",
    groups: [],
    nodes: [
      {
        id: "hub",
        label: "Projects / Models / Video / Previous",
        kind: "page",
        description: "Collapsed hub node.",
        groupId: null,
      },
    ],
    edges: [],
  });

  assert.ok(graph);
  const issues = validateFlowchartGraph(graph!);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, "combined-surface-label");
});

test("extractNavigationHintsFromText finds Frames-style view unions and hub tabs", () => {
  const source = `
    const [view, setView] = useState<
      | 'login'
      | 'projects'
      | 'storyboard'
      | 'model-builder'
      | 'model-detail'
    >('login');

    {(['projects', 'models', 'video', 'previous'] as const).map((tab) => (
      <button key={tab}>{tab}</button>
    ))}
  `;

  const hints = extractNavigationHintsFromText("src/App.tsx", source);
  assert.equal(hints.length, 2);
  assert.deepEqual(hints[0]?.items, ["login", "projects", "storyboard", "model-builder", "model-detail"]);
  assert.deepEqual(hints[1]?.items, ["projects", "models", "video", "previous"]);
});

test("extractActionHintsFromText finds major user actions", () => {
  const source = `
    const handleCreateProject = () => {};
    const handleOpenModel = () => {};
    const handleImportProject = () => {};
    const handleSaveProject = () => {};
    const handleArchiveSelected = () => {};
    const handleDeleteSelectedProjects = () => {};
  `;

  const actions = extractActionHintsFromText("src/App.tsx", source).map((item) => item.label);
  assert.deepEqual(actions, [
    "create project",
    "open model",
    "import project",
    "save project",
    "archive selected",
    "delete selected projects",
  ]);
});

test("flowchartGraphJsonSchema includes explicit types for response-format enums", () => {
  const source = readFileSync(new URL("../src/main/utils/flowchart.ts", import.meta.url), "utf8");

  assert.match(source, /kind:\s*\{\s*type:\s*"string",\s*enum:\s*\["entry", "page", "action", "system"\]\s*\}/);
  assert.match(source, /version:\s*\{\s*type:\s*"integer",\s*enum:\s*\[1\]\s*\}/);
  assert.match(source, /direction:\s*\{\s*type:\s*"string",\s*enum:\s*\["TD", "LR"\]\s*\}/);
});
