import type { LayoutNode } from "../lib/flowchart-layout";

const KIND_LABELS: Record<string, string> = {
  entry: "Entry Point",
  page: "Page",
  action: "User Action",
  system: "System Process",
};

export function FlowchartNode({
  layoutNode,
  isSelected,
  isVisible,
  diffStatus,
  onSelect,
}: {
  layoutNode: LayoutNode;
  isSelected: boolean;
  isVisible: boolean;
  diffStatus?: "added" | "modified" | "removed" | null;
  onSelect: (id: string) => void;
}) {
  const { id, x, y, width, height, node } = layoutNode;
  const kindClass = `flowchartNode--${node.kind}`;
  const stateClass = isSelected
    ? "flowchartNode--selected"
    : isVisible
      ? ""
      : "flowchartNode--hidden";
  const diffClass = diffStatus ? `flowchartNode--${diffStatus}` : "";

  return (
    <button
      className={`flowchartNode ${kindClass} ${stateClass} ${diffClass}`.trim()}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
      }}
      onClick={() => onSelect(id)}
      aria-label={`${node.label} (${KIND_LABELS[node.kind] ?? node.kind}): ${node.description}`}
      title={node.description}
    >
      <span className="flowchartNodeLabel">{node.label}</span>
    </button>
  );
}

export { KIND_LABELS };
