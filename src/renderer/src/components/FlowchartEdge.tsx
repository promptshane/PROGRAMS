import type { LayoutEdge } from "../lib/flowchart-layout";

function buildPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  const parts: string[] = [`M${points[0].x},${points[0].y}`];

  if (points.length === 2) {
    parts.push(`L${points[1].x},${points[1].y}`);
    return parts.join(" ");
  }

  // Use quadratic bezier curves through intermediate points for smooth edges
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;

    if (i === points.length - 2) {
      // Last segment: curve to final point
      parts.push(`Q${curr.x},${curr.y} ${next.x},${next.y}`);
    } else {
      parts.push(`Q${curr.x},${curr.y} ${midX},${midY}`);
    }
  }

  return parts.join(" ");
}

export function FlowchartEdge({
  layoutEdge,
  isVisible,
}: {
  layoutEdge: LayoutEdge;
  isVisible: boolean;
}) {
  const { points, label } = layoutEdge;
  if (points.length < 2) return null;

  const d = buildPath(points);
  const opacity = isVisible ? 1 : 0;

  // Label at midpoint
  const midIdx = Math.floor(points.length / 2);
  const labelPos = points[midIdx];

  return (
    <g className="flowchartEdgeGroup" style={{ opacity, transition: "opacity 0.25s ease" }}>
      <path
        d={d}
        className="flowchartEdgePath"
        fill="none"
        markerEnd="url(#flowchart-arrowhead)"
      />
      {label && labelPos ? (
        <text
          x={labelPos.x}
          y={labelPos.y - 8}
          className="flowchartEdgeLabel"
          textAnchor="middle"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}
