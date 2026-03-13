import type { FlowchartGraph } from "@shared/types";

/**
 * Build adjacency map (both directions) for BFS traversal.
 */
function buildAdjacency(graph: FlowchartGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adj.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    adj.get(edge.from)?.add(edge.to);
    adj.get(edge.to)?.add(edge.from);
  }
  return adj;
}

/**
 * BFS from a selected node, returning all node IDs reachable within `hops` steps.
 */
export function getVisibleNodeIds(
  graph: FlowchartGraph,
  selectedNodeId: string | null,
  hops: number,
): Set<string> {
  const allIds = new Set(graph.nodes.map((n) => n.id));

  // No selection or hops covers everything → show all
  if (!selectedNodeId || !allIds.has(selectedNodeId) || hops >= graph.nodes.length) {
    return allIds;
  }

  const adj = buildAdjacency(graph);
  const visible = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: selectedNodeId, depth: 0 }];
  visible.add(selectedNodeId);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= hops) continue;

    const neighbors = adj.get(id);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (!visible.has(neighbor)) {
        visible.add(neighbor);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  return visible;
}

/**
 * Compute the graph diameter (longest shortest path between any two nodes).
 * This determines the maximum meaningful zoom level.
 */
export function getMaxHops(graph: FlowchartGraph): number {
  if (graph.nodes.length <= 1) return 1;

  const adj = buildAdjacency(graph);
  let maxDist = 1;

  for (const startNode of graph.nodes) {
    const visited = new Set<string>([startNode.id]);
    const queue: Array<{ id: string; depth: number }> = [{ id: startNode.id, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth > maxDist) maxDist = depth;

      const neighbors = adj.get(id);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ id: neighbor, depth: depth + 1 });
        }
      }
    }
  }

  return maxDist;
}

/**
 * Find the first entry node, or fall back to the first node in the graph.
 */
export function getDefaultNodeId(graph: FlowchartGraph): string | null {
  if (graph.nodes.length === 0) return null;
  const entry = graph.nodes.find((n) => n.kind === "entry");
  return entry ? entry.id : graph.nodes[0].id;
}
