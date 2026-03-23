import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { FlowchartGraph } from "@shared/types";
import { normalizeFlowchartGraph } from "@shared/flowchart";
import { computeLayout, type FlowchartLayout, type LayoutNode } from "../lib/flowchart-layout";

export interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

export interface FlowchartViewerState {
  layout: FlowchartLayout;
  selectedNodeId: string | null;
  selectedNode: LayoutNode | null;
  scale: number;
  minScale: number;
  maxScale: number;
  visibleNodeIds: Set<string>;
  viewTransform: ViewTransform;
  selectNode: (id: string) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
}

const ZOOM_STEP = 0.25;
const MAX_SCALE = 3.0;

function computeFitTransform(
  layout: FlowchartLayout,
  containerWidth: number,
  containerHeight: number,
): ViewTransform {
  if (layout.width === 0 || layout.height === 0) return { x: 0, y: 0, scale: 1 };
  const scaleX = containerWidth / layout.width;
  const scaleY = containerHeight / layout.height;
  const scale = Math.min(scaleX, scaleY, 1.5);
  const x = (containerWidth - layout.width * scale) / 2;
  const y = (containerHeight - layout.height * scale) / 2;
  return { x, y, scale };
}

export function useFlowchartViewer(
  rawGraph: FlowchartGraph | null,
  containerWidth: number,
  containerHeight: number,
): FlowchartViewerState {
  const graph = useMemo(() => normalizeFlowchartGraph(rawGraph), [rawGraph]);
  const layout = useMemo(
    () => (graph ? computeLayout(graph) : { nodes: [], edges: [], width: 0, height: 0 }),
    [graph],
  );

  const fitTransform = useMemo(
    () => computeFitTransform(layout, containerWidth, containerHeight),
    [layout, containerWidth, containerHeight],
  );

  const minScale = fitTransform.scale;

  const [scale, setScale] = useState(fitTransform.scale);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const prevGraphRef = useRef(rawGraph);
  // Reset when graph or container changes
  useEffect(() => {
    if (rawGraph !== prevGraphRef.current) {
      prevGraphRef.current = rawGraph;
      setSelectedNodeId(null);
      setScale(fitTransform.scale);
    }
  }, [rawGraph, fitTransform.scale]);

  // Sync scale floor when container resizes
  useEffect(() => {
    setScale((prev) => Math.max(prev, fitTransform.scale));
  }, [fitTransform.scale]);

  const selectedNode = useMemo(
    () => layout.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [layout.nodes, selectedNodeId],
  );

  // All nodes are always visible in overview mode
  const visibleNodeIds = useMemo(() => new Set(layout.nodes.map((n) => n.id)), [layout.nodes]);

  const viewTransform = useMemo((): ViewTransform => {
    // Centered x,y for current scale (may be negative when zoomed in, that's fine)
    const cx = (containerWidth - layout.width * scale) / 2;
    const cy = (containerHeight - layout.height * scale) / 2;

    if (!selectedNodeId) return { x: cx, y: cy, scale };

    const node = layout.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return { x: cx, y: cy, scale };

    // Pan to center on selected node at current scale
    const nodeCx = node.x + node.width / 2;
    const nodeCy = node.y + node.height / 2;
    return {
      x: containerWidth / 2 - nodeCx * scale,
      y: containerHeight / 2 - nodeCy * scale,
      scale,
    };
  }, [selectedNodeId, layout.nodes, layout.width, layout.height, scale, containerWidth, containerHeight]);

  const selectNode = useCallback((id: string) => {
    setSelectedNodeId((prev) => (prev === id ? null : id));
  }, []);

  const zoomIn = useCallback(() => {
    setScale((prev) => Math.min(MAX_SCALE, parseFloat((prev + ZOOM_STEP).toFixed(10))));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((prev) => Math.max(minScale, parseFloat((prev - ZOOM_STEP).toFixed(10))));
  }, [minScale]);

  const resetView = useCallback(() => {
    setSelectedNodeId(null);
    setScale(fitTransform.scale);
  }, [fitTransform.scale]);

  return {
    layout,
    selectedNodeId,
    selectedNode,
    scale,
    minScale,
    maxScale: MAX_SCALE,
    visibleNodeIds,
    viewTransform,
    selectNode,
    zoomIn,
    zoomOut,
    resetView,
  };
}
