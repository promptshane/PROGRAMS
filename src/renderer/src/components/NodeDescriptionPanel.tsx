import type { LayoutNode } from "../lib/flowchart-layout";
import { KIND_LABELS } from "./FlowchartNode";

export function NodeDescriptionPanel({ node }: { node: LayoutNode }) {
  const kindLabel = KIND_LABELS[node.node.kind] ?? node.node.kind;

  return (
    <div className="nodeDescriptionPanel">
      <div className="nodeDescriptionHeader">
        <strong className="nodeDescriptionTitle">{node.node.label}</strong>
        <span className="nodeDescriptionKind">{kindLabel}</span>
      </div>
      {node.node.description.trim() ? (
        <p className="nodeDescriptionText">{node.node.description}</p>
      ) : null}
    </div>
  );
}
