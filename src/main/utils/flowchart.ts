import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { z } from "zod";
import { createStarterFlowchart } from "../defaults.ts";
import { pathExists, readTextFile, writeTextFile } from "./fs.ts";
import { compileFlowchartGraph, normalizeFlowchartGraph, validateFlowchartGraph } from "../../shared/flowchart.ts";
import {
  extractActionHintsFromText,
  extractNavigationHintsFromText,
  type FlowchartHintGroup,
  type FlowchartHintItem,
} from "../../shared/flowchart-hints.ts";
import type { FlowchartGraph, FlowchartSnapshot, Project } from "../../shared/types";

const MAX_HINT_FILES = 120;
const MAX_HINT_FILE_BYTES = 64_000;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mdx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".programs",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);
export interface FlowchartRepoHints {
  routes: FlowchartHintItem[];
  navigation: FlowchartHintGroup[];
  actions: FlowchartHintItem[];
}

const flowchartGroupJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "description"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
  },
} as const;

const flowchartNodeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "kind", "description", "groupId"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    kind: { type: "string", enum: ["entry", "page", "action", "system"] },
    description: { type: "string" },
    groupId: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
} as const;

const flowchartEdgeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["from", "to", "label"],
  properties: {
    from: { type: "string" },
    to: { type: "string" },
    label: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
  },
} as const;

export const flowchartGraphJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "direction", "groups", "nodes", "edges"],
  properties: {
    version: { type: "integer", enum: [1] },
    direction: { type: "string", enum: ["TD", "LR"] },
    groups: { type: "array", items: flowchartGroupJsonSchema },
    nodes: { type: "array", items: flowchartNodeJsonSchema },
    edges: { type: "array", items: flowchartEdgeJsonSchema },
  },
} as const;

export const nullableFlowchartGraphJsonSchema = {
  anyOf: [flowchartGraphJsonSchema, { type: "null" }],
} as const;

const flowchartGroupSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

const flowchartNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["entry", "page", "action", "system"]),
  description: z.string(),
  groupId: z.string().nullable(),
});

const flowchartEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().nullable(),
});

export const flowchartGraphSchema = z.object({
  version: z.literal(1),
  direction: z.enum(["TD", "LR"]),
  groups: z.array(flowchartGroupSchema),
  nodes: z.array(flowchartNodeSchema),
  edges: z.array(flowchartEdgeSchema),
});

const humanizeSegment = (value: string): string =>
  value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const prioritizeHintFile = (relativePath: string): number => {
  if (/\/App\.(t|j)sx?$/i.test(relativePath) || /^App\.(t|j)sx?$/i.test(relativePath)) {
    return 0;
  }
  if (/\/page\.(t|j)sx?$/i.test(relativePath)) {
    return 1;
  }
  if (/\/pages?\//i.test(relativePath)) {
    return 2;
  }
  return 3;
};

const collectLikelySourceFiles = async (rootPath: string): Promise<string[]> => {
  const discovered: string[] = [];

  const visit = async (dirPath: string): Promise<void> => {
    if (discovered.length >= MAX_HINT_FILES) {
      return;
    }

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (discovered.length >= MAX_HINT_FILES) {
        return;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await visit(join(dirPath, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = entry.name.slice(entry.name.lastIndexOf("."));
      if (!SOURCE_EXTENSIONS.has(extension)) {
        continue;
      }

      discovered.push(join(dirPath, entry.name));
    }
  };

  await visit(rootPath);
  return discovered
    .sort((left, right) => {
      const leftRelative = relative(rootPath, left);
      const rightRelative = relative(rootPath, right);
      return prioritizeHintFile(leftRelative) - prioritizeHintFile(rightRelative) || leftRelative.localeCompare(rightRelative);
    })
    .slice(0, MAX_HINT_FILES);
};

const extractRouteHints = (rootPath: string, relativePath: string): FlowchartHintItem[] => {
  if (/^app(?:\/.*)?\/page\.(t|j)sx?$/i.test(relativePath)) {
    const segments = relativePath.split(sep);
    const routeSegments = segments.slice(1, -1).filter((segment) => segment !== "index");
    const label = routeSegments.length ? routeSegments.map(humanizeSegment).join(" / ") : "Home";
    return [{ file: relativePath, label }];
  }

  if (/^(?:src\/)?pages\/.+\.(t|j)sx?$/i.test(relativePath)) {
    const segments = relativePath.split(sep);
    const pageSegments = segments.slice(segments.indexOf("pages") + 1).join("/").replace(/\.(t|j)sx?$/i, "");
    if (!pageSegments || pageSegments.startsWith("_")) {
      return [];
    }
    return [{ file: relativePath, label: pageSegments.split("/").map(humanizeSegment).join(" / ") }];
  }

  if (basename(relativePath).match(/^App\.(t|j)sx?$/i)) {
  return [{ file: relativePath, label: "App shell" }];
  }

  return [];
};

export const collectFlowchartRepoHints = async (projectRoot: string): Promise<FlowchartRepoHints> => {
  const files = await collectLikelySourceFiles(projectRoot);
  const routes: FlowchartHintItem[] = [];
  const navigation: FlowchartHintGroup[] = [];
  const actions: FlowchartHintItem[] = [];
  const seenRouteKeys = new Set<string>();
  const seenActionKeys = new Set<string>();
  const seenNavigationKeys = new Set<string>();

  for (const filePath of files) {
    const relativePath = relative(projectRoot, filePath);
    const routeHints = extractRouteHints(projectRoot, relativePath);
    for (const route of routeHints) {
      const key = `${route.file}:${route.label}`;
      if (seenRouteKeys.has(key)) {
        continue;
      }
      seenRouteKeys.add(key);
      routes.push(route);
    }

    const text = await readTextFile(filePath, "");
    if (!text || text.length > MAX_HINT_FILE_BYTES) {
      continue;
    }

    for (const hint of extractNavigationHintsFromText(relativePath, text)) {
      const key = `${hint.file}:${hint.source}:${hint.items.join("|")}`;
      if (seenNavigationKeys.has(key)) {
        continue;
      }
      seenNavigationKeys.add(key);
      navigation.push(hint);
    }

    for (const hint of extractActionHintsFromText(relativePath, text)) {
      const key = `${hint.file}:${hint.label}`;
      if (seenActionKeys.has(key)) {
        continue;
      }
      seenActionKeys.add(key);
      actions.push(hint);
    }
  }

  return {
    routes: routes.slice(0, 12),
    navigation: navigation.slice(0, 10),
    actions: actions.slice(0, 20),
  };
};

export const formatFlowchartRepoHints = (hints: FlowchartRepoHints): string => {
  const sections: string[] = [];

  if (hints.routes.length) {
    sections.push("Observed route-like screens:");
    for (const route of hints.routes) {
      sections.push(`- ${route.label} (${route.file})`);
    }
  }

  if (hints.navigation.length) {
    sections.push("Observed navigation states and tab groups:");
    for (const group of hints.navigation) {
      sections.push(`- ${group.source}: ${group.items.join(", ")} (${group.file})`);
    }
  }

  if (hints.actions.length) {
    sections.push("Observed major user actions:");
    for (const action of hints.actions) {
      sections.push(`- ${action.label} (${action.file})`);
    }
  }

  return sections.length ? sections.join("\n") : "No strong local route or navigation hints were detected.";
};

const getFlowchartGraphPath = (flowchartPath: string): string =>
  flowchartPath.endsWith(".mmd") ? `${flowchartPath.slice(0, -4)}.graph.json` : `${flowchartPath}.graph.json`;

const readFlowchartGraphFile = async (flowchartPath: string): Promise<FlowchartGraph | null> => {
  const graphPath = getFlowchartGraphPath(flowchartPath);
  if (!(await pathExists(graphPath))) {
    return null;
  }

  const raw = await readTextFile(graphPath, "");
  if (!raw.trim()) {
    return null;
  }

  try {
    const parsed = flowchartGraphSchema.parse(JSON.parse(raw));
    return normalizeFlowchartGraph(parsed);
  } catch {
    return null;
  }
};

export const readFlowchartSnapshot = async (project: Project): Promise<FlowchartSnapshot> => {
  const fallback = createStarterFlowchart(project.name);
  const flowchart = await readTextFile(project.flowchartPath, fallback);
  const flowchartGraph = await readFlowchartGraphFile(project.flowchartPath);
  return {
    flowchart,
    flowchartGraph,
  };
};

export const materializeFlowchartSnapshot = (graph: FlowchartGraph): FlowchartSnapshot & { validationIssues: string[] } => {
  const normalized = normalizeFlowchartGraph(graph);
  if (!normalized) {
    throw new Error("A structured flowchart graph is required.");
  }

  const validationIssues = validateFlowchartGraph(normalized).map((issue) => issue.message);
  return {
    flowchart: compileFlowchartGraph(normalized),
    flowchartGraph: normalized,
    validationIssues,
  };
};

export const writeFlowchartSnapshot = async (project: Project, snapshot: FlowchartSnapshot): Promise<void> => {
  await writeTextFile(project.flowchartPath, snapshot.flowchart);
  if (snapshot.flowchartGraph) {
    await writeTextFile(getFlowchartGraphPath(project.flowchartPath), `${JSON.stringify(snapshot.flowchartGraph, null, 2)}\n`);
  }
};

export const FLOWCHART_PROMPT_RULES = `
- Output a structured flowchart graph, not Mermaid.
- Give every major page, route, screen, or top-level tab its own node.
- Never combine multiple major surfaces in one slash-separated label.
- Use groups for hubs or workflow sections that contain two or more related nodes.
- Default to pages plus major user actions.
- Only include system/infrastructure nodes when they materially change the user journey.
- Keep descriptions short, concrete, and useful on hover.
- Use stable snake_case ids for groups and nodes.
`.trim();

export const FLOWCHART_OUTPUT_CONTRACT = `
Return ONLY strict JSON matching this shape:
{
  "flowchartGraph": {
    "version": 1,
    "direction": "TD" | "LR",
    "groups": [{ "id": string, "label": string, "description": string }],
    "nodes": [
      {
        "id": string,
        "label": string,
        "kind": "entry" | "page" | "action" | "system",
        "description": string,
        "groupId": string | null
      }
    ],
    "edges": [{ "from": string, "to": string, "label": string | null }]
  }
}
`.trim();
