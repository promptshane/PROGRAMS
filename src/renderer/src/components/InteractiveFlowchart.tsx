import { useRef, useState, useEffect, useCallback } from "react";
import type { FlowchartGraph, Theme } from "@shared/types";
import { useFlowchartViewer } from "../hooks/useFlowchartViewer";
import { FlowchartNode } from "./FlowchartNode";
import { FlowchartEdge } from "./FlowchartEdge";
import { FlowchartControls } from "./FlowchartControls";
import { NodeDescriptionPanel } from "./NodeDescriptionPanel";

export function InteractiveFlowchart({
  graph,
  theme,
  diffHighlights,
}: {
  graph: FlowchartGraph;
  theme: Theme;
  diffHighlights?: {
    added: Set<string>;
    modified: Set<string>;
    removed: Set<string>;
  };
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const viewer = useFlowchartViewer(graph, containerSize.width, containerSize.height);
  const { layout, selectedNodeId, selectedNode, zoomLevel, maxZoom, visibleNodeIds, viewTransform, selectNode, zoomIn, zoomOut, resetView } = viewer;

  const getDiffStatus = useCallback(
    (nodeId: string): "added" | "modified" | "removed" | null => {
      if (!diffHighlights) return null;
      if (diffHighlights.added.has(nodeId)) return "added";
      if (diffHighlights.modified.has(nodeId)) return "modified";
      if (diffHighlights.removed.has(nodeId)) return "removed";
      return null;
    },
    [diffHighlights],
  );

  if (layout.nodes.length === 0) {
    return (
      <div className="flowchartViewer flowchartViewer--empty">
        <p className="helperText">No flowchart data available.</p>
      </div>
    );
  }

  return (
    <div className={`flowchartViewer flowchartViewer--${theme}`}>
      <div ref={viewportRef} className="flowchartViewport">
        <div
          className="flowchartCanvas"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${viewTransform.scale})`,
          }}
        >
          {/* Edge layer (SVG) */}
          <svg
            className="flowchartEdgeLayer"
            width={layout.width}
            height={layout.height}
          >
            <defs>
              <marker
                id="flowchart-arrowhead"
                markerWidth="10"
                markerHeight="8"
                refX="9"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L10,4 L0,8 Z" className="flowchartArrowhead" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const bothVisible = visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to);
              return (
                <FlowchartEdge
                  key={`${edge.from}-${edge.to}`}
                  layoutEdge={edge}
                  isVisible={bothVisible}
                />
              );
            })}
          </svg>

          {/* Node layer (DOM) */}
          {layout.nodes.map((layoutNode) => (
            <FlowchartNode
              key={layoutNode.id}
              layoutNode={layoutNode}
              isSelected={layoutNode.id === selectedNodeId}
              isVisible={visibleNodeIds.has(layoutNode.id)}
              diffStatus={getDiffStatus(layoutNode.id)}
              onSelect={selectNode}
            />
          ))}
        </div>
      </div>

      <FlowchartControls
        zoomLevel={zoomLevel}
        maxZoom={maxZoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={resetView}
      />

      {selectedNode ? <NodeDescriptionPanel node={selectedNode} /> : null}
    </div>
  );
}
