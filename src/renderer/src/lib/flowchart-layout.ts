import dagre from "@dagrejs/dagre";
import type { FlowchartGraph, FlowchartNode, FlowchartEdge } from "@shared/types";
import { normalizeFlowchartGraph } from "@shared/flowchart";

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  node: FlowchartNode;
}

export interface LayoutEdge {
  from: string;
  to: string;
  label: string | null;
  points: Array<{ x: number; y: number }>;
  edge: FlowchartEdge;
}

export interface FlowchartLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const NODE_BASE_WIDTH = 160;
const NODE_HEIGHT = 50;
const CHAR_WIDTH = 8;
const NODE_PADDING = 40;

function estimateNodeWidth(label: string): number {
  return Math.max(NODE_BASE_WIDTH, label.length * CHAR_WIDTH + NODE_PADDING);
}

export function computeLayout(rawGraph: FlowchartGraph): FlowchartLayout {
  const graph = normalizeFlowchartGraph(rawGraph);
  if (!graph) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: graph.direction === "LR" ? "LR" : "TB",
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add group (compound) nodes
  for (const group of graph.groups) {
    g.setNode(`cluster_${group.id}`, { label: group.label, clusterLabelPos: "top" });
  }

  // Add nodes
  for (const node of graph.nodes) {
    const width = estimateNodeWidth(node.label);
    g.setNode(node.id, { label: node.label, width, height: NODE_HEIGHT });
    if (node.groupId) {
      g.setParent(node.id, `cluster_${node.groupId}`);
    }
  }

  // Add edges
  for (const edge of graph.edges) {
    g.setEdge(edge.from, edge.to, { label: edge.label ?? undefined });
  }

  dagre.layout(g);

  const layoutNodes: LayoutNode[] = [];
  for (const node of graph.nodes) {
    const info = g.node(node.id);
    if (!info) continue;
    layoutNodes.push({
      id: node.id,
      x: info.x - info.width / 2,
      y: info.y - info.height / 2,
      width: info.width,
      height: info.height,
      node,
    });
  }

  const layoutEdges: LayoutEdge[] = [];
  for (const edge of graph.edges) {
    const info = g.edge(edge.from, edge.to);
    if (!info) continue;
    layoutEdges.push({
      from: edge.from,
      to: edge.to,
      label: edge.label,
      points: (info.points ?? []).map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
      edge,
    });
  }

  const graphInfo = g.graph();
  const width = graphInfo?.width ?? 800;
  const height = graphInfo?.height ?? 600;

  return { nodes: layoutNodes, edges: layoutEdges, width, height };
}
