import type {
  FlowchartDirection,
  FlowchartEdge,
  FlowchartGraph,
  FlowchartGroup,
  FlowchartNode,
  FlowchartNodeKind,
} from "./types";

const DEFAULT_DIRECTION: FlowchartDirection = "TD";
const VALID_DIRECTIONS = new Set<FlowchartDirection>(["TD", "LR"]);
const VALID_NODE_KINDS = new Set<FlowchartNodeKind>(["entry", "page", "action", "system"]);

export interface FlowchartGraphIssue {
  code: "combined-surface-label" | "empty-group";
  message: string;
  nodeId?: string;
  groupId?: string;
}

const sanitizeId = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const candidate = normalized || fallback;
  return /^[a-z_]/.test(candidate) ? candidate : `_${candidate}`;
};

const ensureUniqueId = (candidate: string, used: Set<string>): string => {
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }

  let index = 2;
  while (used.has(`${candidate}_${index}`)) {
    index += 1;
  }

  const unique = `${candidate}_${index}`;
  used.add(unique);
  return unique;
};

const sanitizeText = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  return trimmed || fallback;
};

const escapeMermaidLabel = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "<br/>");

const renderNodeDefinition = (node: FlowchartNode): string => {
  const label = escapeMermaidLabel(node.label);
  switch (node.kind) {
    case "entry":
      return `${node.id}(["${label}"])`;
    case "action":
      return `${node.id}("${label}")`;
    case "system":
      return `${node.id}[["${label}"]]`;
    case "page":
    default:
      return `${node.id}["${label}"]`;
  }
};

const isCombinedSurfaceLabel = (value: string): boolean => {
  const parts = value
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 1;
};

export const normalizeFlowchartGraph = (graph: FlowchartGraph | null | undefined): FlowchartGraph | null => {
  if (!graph) {
    return null;
  }

  const usedGroupIds = new Set<string>();
  const usedNodeIds = new Set<string>();
  const groups: FlowchartGroup[] = [];
  const groupIdMap = new Map<string, string>();

  for (const [index, rawGroup] of (graph.groups ?? []).entries()) {
    const label = sanitizeText(rawGroup?.label ?? "", `Group ${index + 1}`);
    const description = sanitizeText(rawGroup?.description ?? "", label);
    const requestedId = rawGroup?.id ?? label;
    const id = ensureUniqueId(sanitizeId(requestedId, `group_${index + 1}`), usedGroupIds);
    groups.push({ id, label, description });
    if (rawGroup?.id) {
      groupIdMap.set(rawGroup.id, id);
    }
    groupIdMap.set(label, id);
  }

  const nodes: FlowchartNode[] = [];
  const nodeIdMap = new Map<string, string>();

  for (const [index, rawNode] of (graph.nodes ?? []).entries()) {
    const label = sanitizeText(rawNode?.label ?? "", `Step ${index + 1}`);
    const kind = VALID_NODE_KINDS.has(rawNode?.kind as FlowchartNodeKind)
      ? (rawNode.kind as FlowchartNodeKind)
      : "action";
    const description = sanitizeText(rawNode?.description ?? "", label);
    const requestedId = rawNode?.id ?? label;
    const id = ensureUniqueId(sanitizeId(requestedId, `node_${index + 1}`), usedNodeIds);
    const groupId =
      rawNode?.groupId && groupIdMap.has(rawNode.groupId)
        ? groupIdMap.get(rawNode.groupId) ?? null
        : null;
    nodes.push({ id, label, kind, description, groupId });
    if (rawNode?.id) {
      nodeIdMap.set(rawNode.id, id);
    }
    nodeIdMap.set(label, id);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenEdges = new Set<string>();
  const edges: FlowchartEdge[] = [];

  for (const rawEdge of graph.edges ?? []) {
    const from = rawEdge?.from ? nodeIdMap.get(rawEdge.from) ?? null : null;
    const to = rawEdge?.to ? nodeIdMap.get(rawEdge.to) ?? null : null;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) {
      continue;
    }

    const label = rawEdge?.label?.trim() ? rawEdge.label.trim() : null;
    const edgeKey = `${from}->${to}:${label ?? ""}`;
    if (seenEdges.has(edgeKey)) {
      continue;
    }

    seenEdges.add(edgeKey);
    edges.push({ from, to, label });
  }

  return {
    version: 1,
    direction: VALID_DIRECTIONS.has(graph.direction) ? graph.direction : DEFAULT_DIRECTION,
    groups,
    nodes,
    edges,
  };
};

export const validateFlowchartGraph = (graph: FlowchartGraph): FlowchartGraphIssue[] => {
  const issues: FlowchartGraphIssue[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "page" && isCombinedSurfaceLabel(node.label)) {
      issues.push({
        code: "combined-surface-label",
        nodeId: node.id,
        message: `Page node "${node.label}" combines multiple surfaces. Split it into separate nodes.`,
      });
    }
  }

  for (const group of graph.groups) {
    if (!graph.nodes.some((node) => node.groupId === group.id)) {
      issues.push({
        code: "empty-group",
        groupId: group.id,
        message: `Group "${group.label}" does not contain any nodes.`,
      });
    }
  }

  return issues;
};

export const compileFlowchartGraph = (input: FlowchartGraph): string => {
  const graph = normalizeFlowchartGraph(input);
  if (!graph) {
    throw new Error("A flowchart graph is required to compile Mermaid.");
  }

  const lines: string[] = [`flowchart ${graph.direction}`];
  const groupedNodes = new Set<string>();

  for (const group of graph.groups) {
    const nodes = graph.nodes.filter((node) => node.groupId === group.id);
    if (!nodes.length) {
      continue;
    }

    const clusterId = `cluster_${group.id}`;
    lines.push(`  subgraph ${clusterId}["${escapeMermaidLabel(group.label)}"]`);
    lines.push("    direction TB");
    for (const node of nodes) {
      groupedNodes.add(node.id);
      lines.push(`    ${renderNodeDefinition(node)}`);
    }
    lines.push("  end");
  }

  for (const node of graph.nodes) {
    if (groupedNodes.has(node.id)) {
      continue;
    }
    lines.push(`  ${renderNodeDefinition(node)}`);
  }

  for (const edge of graph.edges) {
    const label = edge.label ? `|${escapeMermaidLabel(edge.label)}|` : "";
    lines.push(`  ${edge.from} -->${label} ${edge.to}`);
  }

  return `${lines.join("\n")}\n`;
};
