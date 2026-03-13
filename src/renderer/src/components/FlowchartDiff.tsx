import { useMemo } from "react";
import type { FlowchartGraph, Theme } from "@shared/types";
import { normalizeFlowchartGraph } from "@shared/flowchart";
import { InteractiveFlowchart } from "./InteractiveFlowchart";

function computeDiffHighlights(
  oldGraph: FlowchartGraph | null,
  newGraph: FlowchartGraph | null,
): { added: Set<string>; modified: Set<string>; removed: Set<string> } {
  const added = new Set<string>();
  const modified = new Set<string>();
  const removed = new Set<string>();

  const oldNorm = normalizeFlowchartGraph(oldGraph);
  const newNorm = normalizeFlowchartGraph(newGraph);

  if (!oldNorm || !newNorm) {
    return { added, modified, removed };
  }

  const oldNodeMap = new Map(oldNorm.nodes.map((n) => [n.id, n]));
  const newNodeMap = new Map(newNorm.nodes.map((n) => [n.id, n]));

  // Nodes in new but not old = added
  // Nodes in both but label changed = modified
  for (const [id, node] of newNodeMap) {
    const oldNode = oldNodeMap.get(id);
    if (!oldNode) {
      added.add(id);
    } else if (oldNode.label !== node.label) {
      modified.add(id);
    }
  }

  // Nodes in old but not new = removed
  for (const id of oldNodeMap.keys()) {
    if (!newNodeMap.has(id)) {
      removed.add(id);
    }
  }

  return { added, modified, removed };
}

export function FlowchartDiff({
  oldGraph,
  newGraph,
  theme,
}: {
  oldGraph: FlowchartGraph | null;
  newGraph: FlowchartGraph | null;
  theme: Theme;
}) {
  const diffHighlights = useMemo(() => computeDiffHighlights(oldGraph, newGraph), [oldGraph, newGraph]);

  const displayGraph = newGraph ?? oldGraph;
  if (!displayGraph) {
    return <div className="helperText">No flowchart data to compare.</div>;
  }

  return (
    <InteractiveFlowchart
      graph={displayGraph}
      theme={theme}
      diffHighlights={diffHighlights}
    />
  );
}
