import { useRef, useState, useEffect, useCallback } from "react";
import type { FlowchartGraph, Theme } from "@shared/types";
import { useFlowchartViewer } from "../hooks/useFlowchartViewer";
import { useGuidedFlowchart } from "../hooks/useGuidedFlowchart";
import { FlowchartNode } from "./FlowchartNode";
import { FlowchartEdge } from "./FlowchartEdge";
import { FlowchartControls } from "./FlowchartControls";
import { NodeDescriptionPanel } from "./NodeDescriptionPanel";
import { GuidedFlowStep } from "./GuidedFlowStep";

type FlowchartMode = "guided" | "overview";

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
  const [containerSize, setContainerSize] = useState({ width: 800, height: 460 });
  // Diff views always use overview; non-diff views start in guided
  const [mode, setMode] = useState<FlowchartMode>(diffHighlights ? "overview" : "guided");

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

  const guided = useGuidedFlowchart(graph);
  const overview = useFlowchartViewer(graph, containerSize.width, containerSize.height);

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

  const isGuided = mode === "guided" && !diffHighlights;

  if (!isGuided && overview.layout.nodes.length === 0) {
    return (
      <div className="flowchartViewer flowchartViewer--empty">
        <p className="helperText">No flowchart data available.</p>
      </div>
    );
  }

  return (
    <div className={`flowchartViewer flowchartViewer--${theme}`}>
      {/* Mode toggle — only shown when not in diff mode */}
      {!diffHighlights ? (
        <div className="flowchartModeToggle">
          <button
            className={`flowchartModeBtn ${mode === "guided" ? "flowchartModeBtn--active" : ""}`}
            onClick={() => setMode("guided")}
          >
            Guided
          </button>
          <button
            className={`flowchartModeBtn ${mode === "overview" ? "flowchartModeBtn--active" : ""}`}
            onClick={() => setMode("overview")}
          >
            Overview
          </button>
        </div>
      ) : null}

      {isGuided ? (
        /* ── Guided mode: pure card layout, no canvas ── */
        guided.currentNode ? (
          <GuidedFlowStep
            currentNode={guided.currentNode}
            options={guided.options}
            canGoBack={guided.canGoBack}
            onNavigate={guided.navigateTo}
            onBack={guided.goBack}
          />
        ) : (
          <div className="flowchartViewer flowchartViewer--empty">
            <p className="helperText">No flowchart data available.</p>
          </div>
        )
      ) : (
        /* ── Overview mode: canvas with transform ── */
        <>
          <div ref={viewportRef} className="flowchartViewport">
            <div
              className="flowchartCanvas"
              style={{
                width: overview.layout.width,
                height: overview.layout.height,
                transform: `translate(${overview.viewTransform.x}px, ${overview.viewTransform.y}px) scale(${overview.viewTransform.scale})`,
              }}
            >
              {/* Edge layer */}
              <svg
                className="flowchartEdgeLayer"
                width={overview.layout.width}
                height={overview.layout.height}
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
                {overview.layout.edges.map((edge) => {
                  const bothVisible =
                    overview.visibleNodeIds.has(edge.from) && overview.visibleNodeIds.has(edge.to);
                  return (
                    <FlowchartEdge
                      key={`${edge.from}-${edge.to}`}
                      layoutEdge={edge}
                      isVisible={bothVisible}
                    />
                  );
                })}
              </svg>

              {/* Node layer */}
              {overview.layout.nodes.map((layoutNode) => (
                <FlowchartNode
                  key={layoutNode.id}
                  layoutNode={layoutNode}
                  isSelected={layoutNode.id === overview.selectedNodeId}
                  isVisible={overview.visibleNodeIds.has(layoutNode.id)}
                  diffStatus={getDiffStatus(layoutNode.id)}
                  onSelect={overview.selectNode}
                />
              ))}
            </div>

            <FlowchartControls
              scale={overview.scale}
              minScale={overview.minScale}
              maxScale={overview.maxScale}
              onZoomIn={overview.zoomIn}
              onZoomOut={overview.zoomOut}
              onReset={overview.resetView}
            />
          </div>

          {overview.selectedNode ? (
            <NodeDescriptionPanel node={overview.selectedNode} />
          ) : null}
        </>
      )}
    </div>
  );
}
